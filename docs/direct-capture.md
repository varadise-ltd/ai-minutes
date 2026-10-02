# Direct Teams and Zoom capture configuration

Open **Administration → Connections → Teams or Zoom → Configure & setup guide**, then select **Direct Teams — Azure Windows media worker** or **Direct Zoom — RTMS receiver**. The six numbered steps on screen cover account registration, worker deployment, credentials, notice/consent, connection testing and a first meeting.

## What is implemented

The platform stores separate Recall/direct configurations with encrypted control credentials, explicit per-platform method selection and no automatic fallback. The direct connector verifies a worker's identity and capabilities, dispatches stable-ID sessions, retrieves lifecycle status, requests stop and imports completed WAV/MP3 recordings into ElevenLabs and automatic AI drafting. It does not use a Recall account.

**Native media workers are not bundled.** This delivery adds the platform-side connector and configuration screens. A compatible Teams media worker or Zoom RTMS receiver must still be implemented and deployed separately. The official SDK samples below are starting points, not drop-in implementations of this contract. No native capture has been tested with a live provider account.

## Configuration and deployment

1. **Teams:** register an Entra application and calling bot, record tenant/client IDs, have the administrator grant the required calling/media permissions, and configure credentials/certificates on an Azure Windows media worker. Follow [calling-bot registration](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/registering-calling-bot) and [media hosting requirements](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/requirements-considerations-application-hosted-media-bots). The worker must satisfy Microsoft's recording-policy requirements and receive success from [updateRecordingStatus](https://learn.microsoft.com/en-us/graph/api/call-updaterecordingstatus?view=graph-rest-1.0) before persisting audio. It must not claim RECORDING merely because a call is connected.
2. **Zoom:** create and authorise an RTMS app using [Zoom's SDK quickstart](https://developers.zoom.us/docs/rtms/meetings/quickstart/), enable meeting-audio access, subscribe to started/stopped events, validate its public HTTPS webhook, and configure the app client secret and webhook secret token on the receiver. Enable the appropriate account meeting-content setting and app auto-start, or have the host start RTMS. RTMS uses paid credits and receives audio without a participant bot. The receiver must match the authorised account and an explicitly armed assignment before storing audio.
3. Implement the control API below on the worker. Keep its provider webhook/media endpoints separate from this control API. Protect the latter with TLS or a trusted private network and a long random bearer key. Deploy one worker identity/key per company tenant/account.
4. In the platform's direct form, enter the worker's control origin, key, provider IDs, name/session label and recording notice. Provider secrets stay on the worker. The platform stores only the worker control key encrypted.
5. Add any additional exact control origin to `CAPTURE_WORKER_ALLOWED_ORIGINS` in the project `.env`, preserving existing origins, then run `docker compose up -d app`. Default local origins are host.docker.internal and localhost on ports 8010/8020, plus teams-media-worker:8010 and zoom-rtms-worker:8020. Docker loopback addresses map to the host. Public Azure addresses should use HTTPS. Redirects, embedded credentials and paths in the base URL are rejected.
6. Save, enable and **Test direct worker**. Select **Use direct integration** at the top. Check the connection list shows **Selected: Direct integration**. Existing Recall credentials are retained. Changing worker origin, identity or key invalidates the prior test. A failed test clears prior verification. A verified worker does not prove a live meeting capture succeeds; run a short consented meeting next.

## Worker protocol v1

All routes require `Authorization: Bearer WORKER_API_KEY`. Never redirect control or audio requests. Return JSON errors without credentials or provider tokens. Restrict all sessions to the worker's configured tenant/account. Retain immutable final audio until import and retention policy permit deletion.

### Health

`GET /v1/health` returns:

```json
{
  "protocol": "ai-minutes-capture/v1",
  "platform": "Zoom",
  "ready": true,
  "clientId": "your-app-client-id",
  "accountId": "your-zoom-account-id",
  "capabilities": {"audio": true, "schedule": true, "stop": true, "idempotentSessions": true, "rtms": true}
}
```

For Teams, platform is `Teams`, `tenantId` replaces `accountId`, and `recordingStatus: true` replaces `rtms: true`. Do not report ready until actual provider credentials, callbacks/media configuration and capabilities are available. A stock HTTP server or SDK sample must not pass this check.

### Dispatch

`PUT /v1/sessions/{meetingUUID}` receives:

```json
{
  "id": "meeting-uuid",
  "platform": "Zoom",
  "meetingUrl": "https://zoom.us/j/123456789",
  "scheduledAt": "2026-09-17T04:00:00.000Z",
  "durationMinutes": 60,
  "consent": true,
  "displayName": "AI Minutes RTMS",
  "notice": "Participants have been informed that audio is recorded for draft minutes."
}
```

Atomically create or return the same session by UUID; repeated PUTs must never duplicate capture. Reject changes to the underlying meeting of an existing ID. Persist scheduling before acknowledging. For Teams, schedule the bot join; for Zoom, arm only this assignment and wait for its authorised RTMS stream. Enforce consent, platform URL validation, time windows, maximum duration and tenant identity. Do not accept arbitrary URLs for server-side fetching.

### Status and stop

Dispatch, `GET /v1/sessions/{meetingUUID}` and `POST /v1/sessions/{meetingUUID}/stop` return:

```json
{
  "id": "same-meeting-uuid",
  "platform": "Zoom",
  "state": "WAITING_FOR_HOST",
  "updatedAt": "2026-09-17T04:00:00.000Z"
}
```

States: `QUEUED`, `JOINING`, `WAITING_FOR_ADMISSION`, `WAITING_FOR_HOST`, `CONNECTED`, `RECORDING`, `PROCESSING`, `COMPLETED`, `STOPPED`, `FAILED`. Update the ISO timestamp whenever state changes. The platform rejects regressing timestamps and polls the worker every ten seconds; the worker should consume native provider events, not substitute provider polling where prohibited.

Stop is idempotent and must retain audio. Stop for an unknown ID must persist a cancelled tombstone, preventing a concurrent/retried PUT from starting it later. Use STOPPED for cancelled sessions with no recording, PROCESSING while finalising captured audio, COMPLETED for importable final audio, and FAILED when intervention is needed. Honour recording policy and host permissions; do not simulate successful admission/recording.

### Recording retrieval

COMPLETED must also include `audio: {"mime":"audio/wav","bytes":12345}` (or `audio/mpeg`). `GET /v1/sessions/{meetingUUID}/audio` streams those exact bytes with bearer authentication. The platform does not follow signed URLs or redirects. Maximum size is 250 MB. The connector checks the exact byte count before queuing transcription and will not overwrite existing recordings/transcripts. Multi-part merging remains the worker's responsibility; preserve partial data for explicit manual recovery.

## Verification boundary

Automated tests use synthetic organisations and mock worker HTTP responses. They cover account/method isolation, key redaction, readiness, no Recall fallback, active-session switching restrictions, status ordering, stop and audio import. They do not prove native Teams media SDK or Zoom RTMS operation. Those components, provider permissions, public endpoints and the first real meeting are outstanding deployment work.
