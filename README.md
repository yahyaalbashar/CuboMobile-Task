# WebRTC + PSTN Bridge

NestJS backend that bridges browser WebRTC calls with real phone (PSTN) calls via the Telnyx Call Control API.

## Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- A Telnyx account with a SIP Connection and phone number

## Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your Telnyx credentials and database settings
   ```

3. **Start infrastructure** (PostgreSQL + Redis):
   ```bash
   docker compose up -d postgres redis
   ```

4. **Run database migrations**:
   ```bash
   npm run migration:run
   ```

5. **Start the application**:
   ```bash
   npm run start:dev
   ```

6. **Access Swagger docs**: Open `http://localhost:3000/api`

## Local Webhook Testing with ngrok

Telnyx webhooks need a publicly reachable URL. Use ngrok for local development:

```bash
ngrok http 3000
```

Copy the `https://xxx.ngrok.io` URL and set it in your `.env`:
```
TELNYX_WEBHOOK_URL=https://xxx.ngrok.io/webhooks/telnyx
```

Also configure this URL in your Telnyx SIP Connection dashboard.

## Demo Client

Open `client/index.html` in a browser (or serve it via a local server):

```bash
npx serve client
```

1. Enter an identity (any string, e.g. "demo-user")
2. Enter a destination phone number (E.164 format, e.g. +12025551234)
3. Click "Call" to initiate a WebRTC-to-PSTN bridged call

## Docker

Run the entire stack with Docker Compose:

```bash
docker compose up --build
```

This starts PostgreSQL, Redis, and the application.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/webrtc-token` | Generate WebRTC token for browser SDK |
| `GET` | `/calls` | Paginated call history |
| `GET` | `/calls/:id` | Full call details with legs and events |
| `POST` | `/calls/:id/hangup` | Terminate an active call (idempotent) |
| `POST` | `/webhooks/telnyx` | Telnyx webhook event ingestion |

## Testing

```bash
npm test
```

## Key Assumptions

- One active call per user session at a time (no concurrent calls from same identity)
- The WebRTC leg is identified by `direction === 'incoming'` matching the SIP connection, not by a client-provided flag
- Duration is calculated as `endedAt - answeredAt` (talk time), not from initiation
- If the PSTN side hangs up, the backend explicitly hangs up the WebRTC leg and vice versa (bridging does not auto-terminate both legs on Telnyx)
- Webhook processing errors are logged and marked `FAILED` in `webhook_deliveries`. They are not retried automatically to prevent infinite loops
- `client_state` base64 encoding is used to pass `callId` to PSTN leg webhooks

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed design decisions.
