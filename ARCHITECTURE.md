# Architecture

## Overview

This is a NestJS backend that bridges WebRTC browser calls with PSTN (real phone) calls via the Telnyx Call Control API. The backend never handles audio — it orchestrates two call legs and bridges them.

```
Browser (WebRTC/SIP)  <-->  Telnyx  <-->  Real Phone (PSTN)
       Leg A                                 Leg B
             ^ backend bridges these via Call Control API ^
```

---

## 1. How is the WebRTC leg initiated and how does the backend know it's the WebRTC leg?

The browser client uses the Telnyx WebRTC JS SDK (`@telnyx/webrtc`). After obtaining a login token via `POST /auth/webrtc-token`, the SDK connects to Telnyx over SIP/WebSocket and initiates a call.

Telnyx sends a `call.initiated` webhook to our backend. We identify this as the WebRTC leg by checking two conditions:
- `data.payload.direction === 'incoming'` — the call is incoming to our SIP connection (not outbound from our API)
- `data.payload.connection_id` matches our configured `TELNYX_SIP_CONNECTION_ID`

This distinguishes it from PSTN legs that our backend dials outbound.

## 2. How does the backend track and correlate each leg to a call record?

Each call has a `Call` record with two `CallLeg` records (WebRTC and PSTN). Each leg stores a `providerCallControlId` — the unique identifier Telnyx uses for call control commands.

When we dial the PSTN leg, we encode `{ callId }` as base64 in the `client_state` parameter. Telnyx echoes this back in all subsequent webhooks for that leg, allowing correlation without a DB lookup.

For the WebRTC leg, we look up the `CallLeg` by `providerCallControlId` from the webhook payload.

## 3. When exactly is the PSTN leg dialed and why at that point?

The PSTN leg is dialed when the WebRTC leg answers (`call.answered` webhook for the WebRTC leg). We wait for the WebRTC leg to be established before dialing PSTN to avoid:
- Wasting PSTN minutes if the WebRTC connection fails
- Having an unanswered PSTN call with no one to bridge to

The state transitions: `INITIATED -> WEBRTC_ANSWERED -> PSTN_DIALING`.

## 4. When exactly is the bridge command issued and why?

The bridge command is issued when the PSTN leg answers (`call.answered` webhook for the PSTN leg). At this point both legs are active and ready for audio. We call `voiceProvider.bridge(webrtcCallControlId, pstnCallControlId)` to connect the audio paths.

The state transitions: `PSTN_ANSWERED -> BRIDGED`.

## 5. How are duplicate webhooks handled (idempotency strategy)?

Three layers of idempotency protection:

1. **Database unique constraint**: `webhook_deliveries.externalEventId` is unique. Duplicate inserts fail with a PostgreSQL unique violation (code 23505), which we catch and no-op.

2. **BullMQ job dedup**: The queue job ID is set to the `externalEventId`. BullMQ natively deduplicates jobs with the same ID.

3. **Processing status check**: Before processing, the worker checks if `processingStatus === 'processed'` and skips if so.

Raw payloads are persisted to `webhook_deliveries` **before** enqueueing to ensure we never lose an event.

## 6. How would a second voice provider (e.g. Twilio) be added without touching domain code?

All domain logic interacts with the `VoiceProvider` interface (defined in `src/modules/providers/voice-provider.interface.ts`). The Telnyx implementation is injected via the `VOICE_PROVIDER` token.

To add Twilio:
1. Create `src/modules/providers/twilio/twilio.provider.ts` implementing `VoiceProvider`
2. Create `twilio-webhook.parser.ts` to normalize Twilio events into `NormalizedCallEvent`
3. Register the new provider under the `VOICE_PROVIDER` token in `ProvidersModule`

Zero changes to `CallOrchestratorService`, `CallsService`, or any domain code.

## 7. What assumptions were made and why?

- **One active call per user session** — simplifies state management; concurrent calls would require session-scoped call tracking
- **WebRTC leg identified by direction + connection_id** — more reliable than client-provided flags since it uses server-side data
- **Duration = endedAt - answeredAt** — measures talk time, not ring time, which is the standard billing metric
- **Bridging does not auto-terminate both legs** — when one side hangs up, we explicitly hang up the other side since Telnyx does not automatically do this
- **Failed webhooks are not retried automatically** — logged as FAILED in `webhook_deliveries` to prevent infinite loops; a manual replay or dead-letter queue is the production approach
- **client_state base64 encoding** — Telnyx requires base64 for client_state; we encode `{ callId }` to correlate PSTN webhooks back to the call record

---

## Module Dependency Graph

```
AppModule
  ├── ConfigModule (global)
  ├── TypeOrmModule
  ├── BullModule
  ├── AuthModule ──> ProvidersModule
  ├── CallsModule ──> ProvidersModule
  ├── WebhooksModule ──> CallsModule, ProvidersModule
  ├── ProvidersModule ──> TelnyxModule
  └── RealtimeModule
```

## Webhook Processing Pipeline

```
POST /webhooks/telnyx
  |
  ├── 1. Verify signature (WebhookSignatureGuard)
  ├── 2. Persist raw payload to webhook_deliveries (status=PENDING)
  ├── 3. Enqueue job to BullMQ (jobId = externalEventId)
  └── 4. Return HTTP 200 immediately
          |
          └── BullMQ Worker
                ├── 1. Check processingStatus — if PROCESSED, skip
                ├── 2. Parse via provider.parseWebhookEvent()
                ├── 3. Route to CallOrchestrator by eventType
                ├── 4. Mark PROCESSED
                └── 5. On error: mark FAILED, log, do NOT re-throw
```

## Call State Machine

```
INITIATED
  └─> WEBRTC_ANSWERED
       └─> PSTN_DIALING
            └─> PSTN_ANSWERED
                 └─> BRIDGED
                      └─> ENDED
  └─> FAILED (any stage)
  └─> ENDED (early hangup)
```

Invalid state transitions are logged as warnings and ignored (no-op).
