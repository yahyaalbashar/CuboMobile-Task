# CLAUDE.md — NestJS Telnyx WebRTC + PSTN Bridge

## Project Overview

A production-oriented voice calling backend built with NestJS and TypeScript. Users initiate calls from a minimal browser client using the Telnyx WebRTC JS SDK. The backend orchestrates a two-leg call: a WebRTC leg (browser → Telnyx) and a PSTN leg (Telnyx → real phone number), bridging them together for live two-way audio.

The evaluators care primarily about **architecture quality, clean abstraction boundaries, correct state transitions, and idempotent webhook handling** — not frontend polish or whether an actual Telnyx account is active.

---

## Mental Model

```
Browser (WebRTC/SIP)  ←→  Telnyx  ←→  Real Phone (PSTN)
       Leg A                                 Leg B
             ↑ backend bridges these via Call Control API ↑
```

- A **leg** is one side of a call — one connection between two endpoints.
- **PSTN** = Public Switched Telephone Network (the real-world phone network).
- **SIP** = Session Initiation Protocol — the signaling protocol the WebRTC SDK uses under the hood to connect to Telnyx.
- Your backend never handles audio. It only issues commands (dial, bridge, hangup) via the Telnyx Call Control API and reacts to webhook events.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | NestJS (latest stable) |
| Language | TypeScript (strict mode) |
| Database | PostgreSQL |
| ORM | TypeORM |
| Queue | BullMQ + Redis (for async webhook processing) |
| Validation | class-validator + class-transformer |
| API Docs | Swagger (@nestjs/swagger) |
| Testing | Jest |
| Config | @nestjs/config with .env |
| HTTP Client | @nestjs/axios or native fetch (for Telnyx API calls) |
| Voice SDK | @telnyx/node (backend), @telnyx/webrtc (browser client) |

---

## Repository Structure

```
/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── modules/
│   │   ├── auth/                   # WebRTC token generation
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   └── auth.service.ts
│   │   ├── calls/                  # Core domain: Call entity + orchestration
│   │   │   ├── calls.module.ts
│   │   │   ├── calls.controller.ts
│   │   │   ├── calls.service.ts
│   │   │   ├── call-orchestrator.service.ts
│   │   │   ├── entities/
│   │   │   │   ├── call.entity.ts
│   │   │   │   ├── call-leg.entity.ts
│   │   │   │   └── call-event.entity.ts
│   │   │   ├── dto/
│   │   │   │   ├── get-calls.dto.ts
│   │   │   │   └── call-response.dto.ts
│   │   │   ├── enums/
│   │   │   │   ├── call-status.enum.ts
│   │   │   │   └── leg-type.enum.ts
│   │   │   └── repositories/
│   │   │       └── call.repository.ts
│   │   ├── providers/              # Provider abstraction layer
│   │   │   ├── providers.module.ts
│   │   │   ├── voice-provider.interface.ts   # THE CORE ABSTRACTION
│   │   │   └── telnyx/
│   │   │       ├── telnyx.module.ts
│   │   │       ├── telnyx.provider.ts        # Implements VoiceProvider
│   │   │       ├── telnyx-webhook.parser.ts  # Maps raw Telnyx events → NormalizedCallEvent
│   │   │       └── dto/
│   │   │           └── telnyx-webhook.dto.ts
│   │   ├── webhooks/               # HTTP ingestion + idempotency
│   │   │   ├── webhooks.module.ts
│   │   │   ├── webhooks.controller.ts
│   │   │   ├── webhooks.service.ts
│   │   │   ├── webhook-processor.ts  # BullMQ processor
│   │   │   └── entities/
│   │   │       └── webhook-delivery.entity.ts
│   │   └── realtime/               # Optional: WebSocket for call state push
│   │       ├── realtime.module.ts
│   │       └── realtime.gateway.ts
│   ├── common/
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── interceptors/
│   │   │   └── logging.interceptor.ts
│   │   └── guards/
│   │       └── webhook-signature.guard.ts
│   └── config/
│       └── configuration.ts
├── client/                         # Minimal browser demo (plain HTML + JS)
│   ├── index.html
│   └── dialer.js
├── migrations/                     # TypeORM migrations (not entities sync)
├── test/
├── docker-compose.yml
├── .env.example
├── README.md
└── ARCHITECTURE.md
```

---

## Core Abstraction: VoiceProvider Interface

This is the most important design decision. All domain logic interacts only with this interface. The Telnyx implementation is injected at runtime. A future Twilio/Vonage provider would implement the same interface without touching domain code.

```typescript
// src/modules/providers/voice-provider.interface.ts

export interface ProviderLeg {
  providerCallControlId: string;
  providerSessionId?: string;
}

export interface NormalizedCallEvent {
  eventType: NormalizedEventType;
  providerCallControlId: string;
  providerSessionId?: string;
  rawPayload: unknown;
  idempotencyKey: string; // stable dedup key, e.g. Telnyx event UUID
}

export enum NormalizedEventType {
  CALL_INITIATED = 'call.initiated',
  CALL_ANSWERED = 'call.answered',
  CALL_HANGUP = 'call.hangup',
  CALL_BRIDGED = 'call.bridged',
  CALL_FAILED = 'call.failed',
}

export interface VoiceProvider {
  readonly providerName: string;

  generateWebRTCToken(identity: string): Promise<string>;

  dialPSTN(params: {
    from: string;
    to: string;
    webhookUrl: string;
    clientState?: string; // used to correlate this leg back to a call record
  }): Promise<ProviderLeg>;

  bridge(params: {
    callControlIdA: string;
    callControlIdB: string;
  }): Promise<void>;

  hangup(callControlId: string): Promise<void>;

  parseWebhookEvent(rawPayload: unknown): NormalizedCallEvent;

  verifyWebhookSignature(payload: string, signature: string): boolean;
}
```

---

## Data Models

### Call Entity

```typescript
// status follows the CallStatus enum state machine strictly
@Entity('calls')
export class Call {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() provider: string;                  // 'telnyx'
  @Column() sourceNumber: string;
  @Column() destinationNumber: string;
  @Column({ type: 'enum', enum: CallStatus }) status: CallStatus;
  @Column({ nullable: true }) failureReason: string;
  @CreateDateColumn() createdAt: Date;
  @Column({ nullable: true }) startedAt: Date;
  @Column({ nullable: true }) answeredAt: Date;
  @Column({ nullable: true }) endedAt: Date;
  @Column({ nullable: true }) durationSeconds: number;
  @OneToMany(() => CallLeg, leg => leg.call) legs: CallLeg[];
  @OneToMany(() => CallEvent, event => event.call) events: CallEvent[];
}
```

### CallLeg Entity

```typescript
@Entity('call_legs')
export class CallLeg {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => Call) call: Call;
  @Column() callId: string;
  @Column({ type: 'enum', enum: LegType }) legType: LegType; // 'webrtc' | 'pstn'
  @Column({ unique: true }) providerCallControlId: string;   // THE key for all commands
  @Column({ nullable: true }) providerSessionId: string;
  @Column({ type: 'enum', enum: LegStatus }) status: LegStatus;
  @CreateDateColumn() createdAt: Date;
}
```

### CallEvent Entity

```typescript
@Entity('call_events')
export class CallEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @ManyToOne(() => Call) call: Call;
  @Column() callId: string;
  @Column({ nullable: true }) legId: string;
  @Column() providerEventType: string;
  @Column({ type: 'jsonb' }) payload: unknown;
  @Column() receivedAt: Date;
}
```

### WebhookDelivery Entity

```typescript
// This is the idempotency table — check this BEFORE processing
@Entity('webhook_deliveries')
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() provider: string;
  @Column({ unique: true }) externalEventId: string; // Telnyx event UUID
  @Column({ type: 'jsonb' }) payload: unknown;
  @Column() receivedAt: Date;
  @Column({
    type: 'enum',
    enum: ProcessingStatus,
    default: ProcessingStatus.PENDING,
  }) processingStatus: ProcessingStatus;
  @Column({ nullable: true }) processedAt: Date;
  @Column({ nullable: true }) errorMessage: string;
}
```

---

## Call State Machine

Define this enum and enforce transitions strictly. Never allow a backward or invalid transition — just log and no-op.

```
INITIATED
  └→ WEBRTC_ANSWERED    (WebRTC leg answers)
       └→ PSTN_DIALING  (backend dials PSTN leg)
            └→ PSTN_ANSWERED  (PSTN picks up)
                 └→ BRIDGED   (bridge command issued and confirmed)
                      └→ ENDED
  └→ FAILED  (at any stage)
  └→ ENDED   (early hangup at any stage)
```

```typescript
export enum CallStatus {
  INITIATED = 'initiated',
  WEBRTC_ANSWERED = 'webrtc_answered',
  PSTN_DIALING = 'pstn_dialing',
  PSTN_ANSWERED = 'pstn_answered',
  BRIDGED = 'bridged',
  ENDED = 'ended',
  FAILED = 'failed',
}

// Valid forward transitions map
export const VALID_TRANSITIONS: Record<CallStatus, CallStatus[]> = {
  [CallStatus.INITIATED]: [CallStatus.WEBRTC_ANSWERED, CallStatus.ENDED, CallStatus.FAILED],
  [CallStatus.WEBRTC_ANSWERED]: [CallStatus.PSTN_DIALING, CallStatus.ENDED, CallStatus.FAILED],
  [CallStatus.PSTN_DIALING]: [CallStatus.PSTN_ANSWERED, CallStatus.ENDED, CallStatus.FAILED],
  [CallStatus.PSTN_ANSWERED]: [CallStatus.BRIDGED, CallStatus.ENDED, CallStatus.FAILED],
  [CallStatus.BRIDGED]: [CallStatus.ENDED],
  [CallStatus.ENDED]: [],
  [CallStatus.FAILED]: [],
};
```

---

## The Real Call Flow (Step by Step)

This is the orchestration logic your `CallOrchestrator` must implement, driven entirely by webhook events.

### Step 1 — WebRTC Leg Initiated
- **Trigger**: Telnyx sends `call.initiated` webhook for the WebRTC leg.
- **How to identify it's the WebRTC leg**: `direction === 'incoming'` + leg is connected to your SIP connection (not dialed by your backend). Alternatively, use `client_state` encoding if you set it during SDK call setup.
- **Actions**:
  1. Check `webhook_deliveries` for `externalEventId` — if exists, return 200 and stop.
  2. Create `Call` record with status `INITIATED`.
  3. Create `CallLeg` record with `legType = 'webrtc'`, store `providerCallControlId`.
  4. Create `CallEvent` record.
  5. Mark `WebhookDelivery` as processed.

### Step 2 — WebRTC Leg Answered
- **Trigger**: `call.answered` webhook where `call_control_id` matches the WebRTC leg.
- **Actions**:
  1. Idempotency check.
  2. Update `Call` status → `WEBRTC_ANSWERED`, set `answeredAt`.
  3. Update WebRTC `CallLeg` status → `answered`.
  4. Call `voiceProvider.dialPSTN()` — pass `clientState` encoding the `callId` so the PSTN leg's webhooks can be correlated back to the correct `Call` record.
  5. Update `Call` status → `PSTN_DIALING`.
  6. Create `CallLeg` record with `legType = 'pstn'`, store the new `providerCallControlId` from the dial response.

### Step 3 — PSTN Leg Answered
- **Trigger**: `call.answered` webhook where `call_control_id` matches the PSTN leg.
- **Actions**:
  1. Idempotency check.
  2. Look up `CallLeg` by `providerCallControlId` → get `callId`.
  3. Update PSTN `CallLeg` status → `answered`.
  4. Update `Call` status → `PSTN_ANSWERED`.
  5. Issue `voiceProvider.bridge(webrtcCallControlId, pstnCallControlId)`.
  6. Update `Call` status → `BRIDGED`.

### Step 4 — Hangup (from either side)
- **Trigger**: `call.hangup` webhook for either leg.
- **Actions**:
  1. Idempotency check.
  2. Look up the `Call` via the leg's `call_control_id`.
  3. If call is already `ENDED`, no-op.
  4. Hangup the other leg via `voiceProvider.hangup(otherLegCallControlId)` — wrapped in try/catch (the other leg may already be gone).
  5. Update both `CallLeg` statuses → `ended`.
  6. Update `Call` status → `ENDED`, compute `durationSeconds = endedAt - answeredAt`.

---

## Webhook Processing Pipeline

Use **queue-based processing** to decouple HTTP response from business logic. This prevents Telnyx from retrying due to slow DB operations.

```
POST /webhooks/telnyx
  │
  ├── 1. Verify signature (WebhookSignatureGuard)
  ├── 2. Persist raw payload to webhook_deliveries with status=PENDING
  ├── 3. Enqueue job to BullMQ (jobId = externalEventId for dedup)
  └── 4. Return HTTP 200 immediately
          │
          └── BullMQ Worker
                ├── 1. Check processingStatus — if PROCESSED, skip
                ├── 2. Parse event via provider.parseWebhookEvent()
                ├── 3. Route to CallOrchestrator method by eventType
                ├── 4. Update WebhookDelivery status → PROCESSED
                └── 5. On error → status = FAILED, log, do NOT re-throw (avoid infinite retry)
```

**Idempotency key**: Use Telnyx's `event_id` (UUID in every payload). This is the `externalEventId` in `WebhookDelivery`. Set BullMQ job ID to this value for native dedup at queue level too.

---

## API Endpoints

### Auth

```
POST /auth/webrtc-token
Body: { identity: string }
Response: { token: string, identity: string }
```
Calls `voiceProvider.generateWebRTCToken(identity)`. The identity is used to correlate the WebRTC leg back to a user. For demo purposes, accept any string identity.

### Calls

```
GET  /calls                    Paginated call history
     Query: page, limit, status, from, to (date range)

GET  /calls/:id                Full call details with legs and events

POST /calls/:id/hangup         Terminate an active call
     Resolves which leg(s) to hangup from the DB, calls provider.hangup()
```

### Webhooks

```
POST /webhooks/telnyx          Telnyx event ingestion
```

---

## Module Wiring

```typescript
// app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({ ... }),
    BullModule.forRootAsync({ ... }),
    AuthModule,
    CallsModule,
    ProvidersModule,
    WebhooksModule,
    RealtimeModule,
  ],
})

// providers.module.ts — register Telnyx as the active provider
@Module({
  providers: [
    TelnyxProvider,
    {
      provide: 'VOICE_PROVIDER',
      useExisting: TelnyxProvider,
    },
  ],
  exports: ['VOICE_PROVIDER'],
})

// calls.module.ts — inject VOICE_PROVIDER token, never TelnyxProvider directly
constructor(@Inject('VOICE_PROVIDER') private voiceProvider: VoiceProvider) {}
```

Adding a second provider later = implement `VoiceProvider`, register it under `'VOICE_PROVIDER'` token, done. Zero domain code changes.

---

## Configuration (.env.example)

```env
# App
PORT=3000
NODE_ENV=development

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=calling_db
DB_USER=postgres
DB_PASSWORD=postgres

# Redis (for BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379

# Telnyx
TELNYX_API_KEY=KEY_xxxx
TELNYX_SIP_CONNECTION_ID=xxxx        # Your SIP Connection ID for WebRTC
TELNYX_PHONE_NUMBER=+1xxxxxxxxxx     # Your Telnyx number used as caller ID
TELNYX_WEBHOOK_SECRET=xxxx           # For signature verification
TELNYX_WEBHOOK_URL=https://your-domain.com/webhooks/telnyx
```

---

## Telnyx-Specific Setup Notes

1. **SIP Connection**: Create a SIP Connection in Telnyx dashboard configured for WebRTC. This is what the browser SDK connects to. The `TELNYX_SIP_CONNECTION_ID` is needed to generate WebRTC credentials.

2. **WebRTC Token**: Call Telnyx API to create a telephony credential or generate a JWT `login_token`. The browser SDK uses this to authenticate.

3. **Webhook URL**: Must be publicly reachable. Use `ngrok` for local dev. Set it on your SIP Connection in the Telnyx dashboard.

4. **Phone Number**: Assign a Telnyx phone number to your SIP Connection. This is the caller ID shown when the PSTN call is placed.

5. **Identifying the WebRTC leg**: When `call.initiated` arrives, check `data.payload.direction === 'incoming'` and the `connection_id` matches your `TELNYX_SIP_CONNECTION_ID`. This distinguishes it from PSTN legs your backend dials.

6. **client_state**: When dialing the PSTN leg, encode `{ callId }` as base64 in the `client_state` parameter. Telnyx echoes this back in all subsequent webhooks for that leg, allowing you to correlate PSTN webhooks to the correct `Call` record without a DB lookup by `call_control_id`.

---

## Demo Client (client/index.html)

Build a single HTML file with minimal JS. No framework needed.

**Must support**:
- Input field for destination phone number
- "Call" button — fetches WebRTC token from `POST /auth/webrtc-token`, initializes Telnyx JS SDK, starts call
- "Hang Up" button — calls `telnyxClient.disconnect()` or `POST /calls/:id/hangup`
- Call state label — shows: idle / calling / connected / ended

**SDK init pattern**:
```javascript
const client = new TelnyxRTC({ login_token: tokenFromBackend });
client.on('telnyx.ready', () => { /* connected to Telnyx */ });
client.on('telnyx.notification', (notification) => {
  // update UI based on notification.call.state
});
client.connect();
```

---

## Build Order

Follow this order strictly. Each step produces a testable artifact before moving on.

1. **Project scaffold** — `nest new`, install dependencies, configure TypeORM, BullMQ, Swagger, ConfigModule
2. **Database migrations** — create all four tables via TypeORM migrations (not `synchronize: true`)
3. **VoiceProvider interface** — define it, mock implementation that logs instead of calling Telnyx
4. **ProvidersModule** — wire mock provider under `'VOICE_PROVIDER'` token
5. **CallsModule entities + repository** — Call, CallLeg, CallEvent entities with TypeORM
6. **Call state machine helper** — `isValidTransition()` utility + `transitionCall()` method
7. **CallOrchestrator** — implement the 4-step flow using the mock provider
8. **WebhooksModule** — HTTP ingestion → BullMQ queue → processor calling orchestrator
9. **AuthModule** — `/auth/webrtc-token` endpoint (mock token if no Telnyx creds yet)
10. **CallsController** — `GET /calls`, `GET /calls/:id`, `POST /calls/:id/hangup`
11. **TelnyxProvider** — replace mock with real Telnyx API calls
12. **WebhookSignatureGuard** — verify Telnyx webhook signatures
13. **Demo client** — `client/index.html`
14. **Swagger** — annotate all DTOs and controllers
15. **Docker Compose** — postgres + redis + app
16. **ARCHITECTURE.md** — write this last when decisions are finalized
17. **Tests** — unit test `CallOrchestrator` with mock provider, test idempotency logic

---

## ARCHITECTURE.md Must Answer These Questions

Write this document as if a senior engineer is joining the team. Cover:

1. How is the WebRTC leg initiated and how does the backend know it's the WebRTC leg?
2. How does the backend track and correlate each leg to a call record?
3. When exactly is the PSTN leg dialed and why at that point?
4. When exactly is the bridge command issued and why?
5. How are duplicate webhooks handled (idempotency strategy)?
6. How would a second voice provider (e.g. Twilio) be added without touching domain code?
7. What assumptions were made and why?

---

## Key Assumptions to State Explicitly

Document these in your README and ARCHITECTURE.md:

- One active call per user session at a time (no concurrent calls from same identity).
- The WebRTC leg is identified by `direction === 'incoming'` matching your SIP connection — not by a client-provided flag.
- Duration is calculated as `endedAt - answeredAt` (talk time), not from initiation.
- If the PSTN side hangs up, the backend receives a hangup webhook for the PSTN leg and explicitly hangs up the WebRTC leg and vice versa (bridging does not auto-terminate both legs on Telnyx).
- Webhook processing errors are logged and marked `FAILED` in `webhook_deliveries`. They are not retried automatically to avoid infinite loops — a manual replay mechanism or dead-letter queue is the production approach.
- `client_state` base64 encoding is used to pass `callId` to PSTN leg webhooks, avoiding an extra DB lookup.

---

## Non-Functional Checklist

Before submitting, verify:

- [ ] All endpoints have Swagger decorators (`@ApiTags`, `@ApiOperation`, `@ApiResponse`)
- [ ] All DTOs use `class-validator` decorators
- [ ] All config values come from `ConfigService`, no hardcoded strings
- [ ] All Telnyx API calls are wrapped in try/catch with meaningful error logging
- [ ] `WebhookDelivery` is persisted **before** enqueuing — never lose a raw event
- [ ] Invalid state transitions are logged as warnings, not thrown as errors
- [ ] `POST /calls/:id/hangup` is idempotent — safe to call twice
- [ ] `.env.example` has every required key with descriptive comments
- [ ] `docker-compose.yml` includes postgres, redis, and the app service
- [ ] README has: setup steps, ngrok instructions for local webhook testing, how to test the demo client
