# AI Minutes Platform

An AI-powered meeting platform for capturing, transcribing, reviewing, and generating structured meeting minutes. It is built as a locally hosted workspace with a React frontend, Node API, PostgreSQL and Docker Compose. App: **http://localhost:5000**. PostgreSQL: **127.0.0.1:7654**.

## Start

1. Keep the generated `.env` file private. It contains this installation's database password and encryption key.
2. Run `docker compose up -d --build` in this folder.
3. Open http://localhost:5000. Create your company and first administrator, or choose **Open sample workspace**.
4. In **Administration**, create departments/teams and assign explicit roles and scopes. Configure ElevenLabs and an OpenAI-compatible minutes provider, then enter the exact model IDs and contracted rates.

The sample workspace contains synthetic meetings. It cannot save credentials, synchronise external accounts, transcribe recordings or call a language model. It is separate from your company. Disable it with `ENABLE_DEMO=false` and recreate the app container when no longer needed.

## Operation

- **Today:** choose **Record a meeting** for the device microphone, paste a meeting link, schedule a future meeting, or upload an authorised recording.
- **Calendar:** view the working week, move between weeks, select meetings, and import upcoming Outlook events for explicit assignment.
- **Minutes:** search meetings, upload recordings, transcribe, or paste a supplied transcript.
- **Review:** use **Name & correct speakers** to name detected speakers and reassign individual segments; use the stable item number and **Attention required** filter to locate validation checks; edit draft text, attach source quotes, verify decisions/actions, save and submit.
- **Transcription preference:** a Teams/Zoom meeting joined by the Recall.ai bot uses Recall.ai post-meeting transcription and participant attribution where available. Phone/browser microphone recordings, uploaded recordings and direct/self-hosted capture use ElevenLabs. Recall transcription requires `transcript.done` and `transcript.failed` webhook subscriptions; earlier ElevenLabs-based Recall recordings can be re-transcribed into a new review draft.
- **Approval:** an approver can approve or return a version with a reason. Approved content is locked; a revision creates a new draft and retains the approved version.
- **Exports:** DOCX is the default; PDF is available. Unapproved versions carry `DRAFT — NOT APPROVED`. Sample exports are labelled sample records.
- **Administration:** provider credentials, account and scope control, organisation units, versioned templates, effective-dated rates, usage and audit history.
- **Brand:** Administration → Brand lets company administrators upload a PNG/JPEG/WebP logo, set the platform name and sign-in tagline, choose body/heading fonts, edit button/sidebar/background/link colours, use presets, and adjust logo width and corner radius. Edits remain in the live preview until Save brand. Restore defaults also requires saving. Branding is company-scoped and audited; a single-company installation also displays its brand at sign-in. Document templates continue to control DOCX/PDF appearance.

Plain pasted transcripts have unknown speaker labels and timestamp 0. Supply JSON segments with actual timestamps to enable accurate evidence navigation. Never interpret placeholder timestamps as recorded evidence.

Browser recording includes pause/resume, playback, download, upload retry and local draft recovery. Phone microphone access requires trusted HTTPS; keep the browser open and the screen unlocked. See [phone recording and speaker naming](docs/mobile-recording.md) for private Tailscale setup and recovery limits. Speaker labels are per meeting, not automatic recognition of a person's identity across meetings.

## Current delivery boundary

The September 17 update adds Traditional Chinese transcripts, automatic AI drafting after transcription, direct speaker-name editing, and uploaded DOCX layouts with matching PDF rendering. See [AI minutes, speaker corrections and Word templates](docs/ai-minutes-and-word-templates.md) for the operating flow and supported placeholders.

This is a working local web-platform foundation, **not the complete production system described in the reference master prompt**.

Implemented: persistent web workflows, local authentication and initial setup, server-enforced organisation/team/role boundaries, recording upload, manual transcript import/correction, reviewed minutes, approval/revision cycle, exports, credentials encrypted at rest, cost snapshots, audit history, PostgreSQL jobs, and Docker health checks.

Implemented with external-account requirements: Microsoft sign-in, directory synchronisation, Outlook calendar retrieval, ElevenLabs file transcription, OpenAI-compatible draft generation and Recall.ai meeting bots for Teams/Zoom. The local Minutes AI gateway passed a synthetic completion check; full meeting processing and live bot attendance remain unverified. Directory synchronisation is manually triggered; removed users are disabled after a successful complete directory read. No automatic recurring sync is claimed.

Teams/Zoom setup is under **Administration → Connections → Configure & setup guide**. The Recall.ai connector schedules a named participant, handles signed status callbacks and imports completed audio into transcription and AI drafting. Unconfigured assignments show **Setup required**. After connection checks pass, new assignments dispatch automatically; host admission and recording permission are still required. See [remote meeting setup](docs/remote-meetings.md).

Each Teams/Zoom configuration now offers **Recall.ai** and **Direct integration**. Direct Teams connects to a separately implemented Azure Windows media worker; direct Zoom connects to a separately implemented RTMS receiver without a participant bot. Both configurations are stored independently. The direct connector implements worker verification, stable session dispatch, stop, status retrieval and audio import, but the native Microsoft/Zoom media workers are **not bundled or deployed**. See [direct capture configuration and worker contract](docs/direct-capture.md). Selecting an unconfigured direct method cannot trigger Recall charges.

Not implemented: native self-hosted Teams/Zoom workers, native iPhone application, Azure infrastructure, encrypted recording/object storage, automated retention/legal holds, administrative step-up authentication, audit immutability against database administrators, invoice reconciliation, and the full production security/load/recovery programme. See [provider setup](docs/provider-setup.md) and [delivery status](docs/delivery-status.md).

## Local deployment and maintenance

All published ports bind to loopback: application 5000, callback-only receiver 5001 and PostgreSQL 7654. For Recall, connect an approved public HTTPS proxy to port 5001 only. No tunnel or public hostname is created automatically. Multi-user deployment needs HTTPS, `COOKIE_SECURE=true`, an appropriate `PUBLIC_URL`, restricted network ingress, production secrets management and completion of the security items above.

Compose creates dedicated `ai-minutes_database` and `ai-minutes_recordings` volumes. `docker compose stop` retains them. Do not run `down -v` unless you deliberately want to erase this installation's data. Keep `.env` with backups: losing `ENCRYPTION_KEY` makes saved provider credentials unreadable.

Database backup: `docker compose exec -T db pg_dump -U minutes -d minutes -Fc > minutes.dump` using a shell that preserves binary output. Back up the recordings volume separately. Restore into a fresh test installation before relying on a backup. Backup/restore is documented but not yet exercised against a production workload.

### Private Tailscale URL through Docker Desktop

On Windows, run the Tailscale Service host in Docker Desktop instead of the Windows Tailscale client. The private URL assigned by your tailnet forwards to the loopback-only application at `host.docker.internal:5000`.

1. In the Tailscale admin console, create a **one-time**, **non-reusable** auth key tagged `tag:minutes-taker-host`.
2. Copy `.env.tailscale.example` to the ignored `.env.tailscale` and paste the generated key as `TAILSCALE_AUTHKEY`.
3. Start only the proxy sidecar:
   `docker compose --env-file .env --env-file .env.tailscale -f compose.yaml -f compose.tailscale.yaml up -d tailscale-service`
4. Approve `minutes-taker-proxy` as the host for `minutes-taker` in **Network → Services**, then test the URL from a different Tailscale device.

The sidecar persists its Tailscale identity in the `tailscale-state` Docker volume. After its first successful login, remove the auth-key line from `.env.tailscale`; the state volume retains the authenticated node. Do not expose Docker ports for this proxy.

### Cloudflare Tunnel through Docker Desktop

Use this for an Internet-facing HTTPS hostname. The included `compose.cloudflared.yaml` runs a **remotely managed** `cloudflared` sidecar: it makes outbound-only connections to Cloudflare and exposes no new Docker ports. It is deliberately separate from `compose.yaml`, so the local-only installation remains local until the sidecar is started.

1. In Cloudflare, open the remotely managed tunnel configured for this application. The tunnel in the dashboard must be healthy. Select **Add a replica**, choose **Docker**, and copy just the `eyJ...` token. Do not paste the generated command into source control or share the token.
2. In this folder, create the ignored secret file and add the token:

   ```powershell
   Copy-Item .env.cloudflared.example .env.cloudflared
   ```

3. In the tunnel's **Routes** tab select **Add route → Published application**. Choose the intended hostname (for example, `minutes.example.com`) and set **Service URL** to `http://app:5000`. `app` is the Compose service name; do **not** use `http://localhost:5000`, because the tunnel runs in a different container.
4. Update the existing ignored `.env` file before starting the tunnel:

   ```dotenv
   PUBLIC_URL=https://minutes.example.com
   COOKIE_SECURE=true
   ```

   Replace the example hostname with the exact published hostname. Keep loopback-only addresses in `LOCAL_ORIGINS`; do not add the Cloudflare hostname there. If the existing private Tailscale URL remains in use, retain it as `MOBILE_ORIGIN`.
5. Start the application and Cloudflare sidecar:

   ```powershell
   docker compose --env-file .env --env-file .env.cloudflared -f compose.yaml -f compose.cloudflared.yaml up -d cloudflared
   ```

6. Verify without printing the token:

   ```powershell
   docker compose --env-file .env --env-file .env.cloudflared -f compose.yaml -f compose.cloudflared.yaml ps cloudflared
   docker compose --env-file .env --env-file .env.cloudflared -f compose.yaml -f compose.cloudflared.yaml logs --tail=50 cloudflared
   curl.exe https://minutes.example.com/api/health
   ```

   The Cloudflare tunnel overview should show an additional healthy replica and one published route. The health endpoint should return JSON with `"status":"ok"`.

Because this application can contain meeting recordings and minutes, protect the published hostname with **Cloudflare Access** before allowing broader use: create a self-hosted application for the exact hostname and add an allow policy for the approved users or identity provider group. If you later publish a Recall callback, use a separate hostname routed to `http://app:5001`; do not put that machine-to-machine endpoint behind an interactive Access login.

## Development

`npm ci`, `npm run build`, `npm test`. Integration tests run against an already running app and its PostgreSQL: `docker compose exec app node --test tests/integration/*.test.mjs`. Tests create and remove isolated, clearly named test organisations only. They do not send data to external providers.

Frontend source: `apps/web`. API: `services/api`. Domain rules: `packages/domain`. Database migration: `services/api/schema.sql` (idempotent initial migration). Review the [architecture decision](docs/architecture.md) for the current modular-monolith scope.
