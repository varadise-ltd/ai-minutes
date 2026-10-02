# Delivery status

## Scope implemented in source

Calendar and day agenda, ad-hoc/scheduled assignment records, private file upload, final-transcript processing adapter, manual transcript entry/correction, draft generation adapter, evidence-linked review, optimistic edit conflicts, approval/rejection/reopen, version selection and DOCX/PDF export, explicit company/department/team scope, role management, local setup/sign-in, Microsoft identity adapter, manual directory sync with soft disabling, calendar retrieval, encrypted integration credentials, rates/FX, usage ledger and audit history.

## External dependencies

The September 16 capture update adds browser microphone recording, local draft recovery, playback/download/upload controls, and a speaker editor with global naming and individual segment reassignment. Source versions and original provider speaker IDs are retained. See [mobile verification](mobile-verification.md) and [usage guide](mobile-recording.md).

Microsoft tenant application/consent and live account validation; ElevenLabs API account/credit; a compatible minutes model and account; Recall.ai account, region-specific API key, verification secret and public HTTPS callback. The managed Teams/Zoom connector is implemented; live bot attendance has not been exercised.

## Remaining reference-spec work

Native Swift iPhone capture client; native self-hosted remote media workers; full schema/presentation-template editor; RLS; cloud infrastructure; retention/legal-hold automation; encrypted audio storage; secrets rotation; administrative reauthentication; immutable external audit archive; recurring directory sync; automatic assembly of multiple recording parts; production load/security/recovery validation; full OpenAPI/contract suite; SSO provider negative-case testing and incident monitoring.

This local build must not be described as complete production implementation of the master prompt. See the final verification section below for checks actually performed.

## Verification

Verified on 16 September 2026:

- Production frontend build completed inside the Docker image. Compose project `ai-minutes` is running with healthy `app` and `db` services. App is bound to `127.0.0.1:5000` and PostgreSQL to `127.0.0.1:7654`.
- All 17 automated tests passed in the final app container: the original seven domain tests and platform integration suite, five recording-controller tests, three speaker-domain tests, and a capture integration suite. The capture suite covers upload access, range playback, immutable original transcripts, speaker correction conflicts, evidence verification reset, and submitted/approved source locks.
- Browser verification covered the day desk, weekly calendar navigation, meeting selection, sample assignment creation, source verification, submission, approval, locked approved content, revised draft creation, administration tabs and rate publishing.
- Desktop visual comparison used the approved meeting-desk reference at 1487 x 1058. Mobile navigation and absence of horizontal overflow were checked at 390 x 844. Screenshot evidence is intentionally omitted from this public source import.
- Fixed and retested a settings-tab data-shape crash, stale meeting details, small typography, list overflow and off-screen mobile navigation focusability. No new browser console errors were observed after the fixes.

The capture update was also checked in the browser: recorder setup and consent gating, speaker naming, segment reassignment, saved transcript version 2, and responsive recorder/speaker dialogs at 390 x 844 without horizontal overflow. These checks used synthetic sample records; no personal microphone audio was recorded. Tailscale phone access remains pending sign-in and a working connection to its coordination server.

Not verified: physical iPhone/Android microphone capture; real provider credentials or calls; live recording upload-to-transcription end to end; Microsoft account/consent flows; Teams/Zoom media capture; native iPhone capture; production scale, security or backup recovery. The September 16 export checks covered file signatures; the September 17 update below adds rendered sample-layout checks. Sample records and statuses remain explicitly labelled illustrative.

## September 17: AI drafting, Traditional Chinese and Word layouts

- Transcription now atomically queues AI generation. Chinese source and AI output use Traditional Chinese, with original source text retained. Blank draft screens guide users to generation; manual items are optional corrections. Provider failure retains the transcript for retry.
- Speaker labels have a direct Rename control. Saving updates that speaker's segments and retains source history. An approver can create a correction draft from submitted/approved minutes while preserving the previous document and approval.
- Administrators can upload placeholder-based DOCX templates, download a starter, validate a synthetic PDF preview, and publish immutable versions. Editable meetings can change templates in a new document version. DOCX/PDF exports use the selected Word layout.
- Latest Docker image was built and deployed; both app and database passed health checks. All 22 unit/integration tests passed inside the app container. Tests cover tenant boundaries, immutable approvals, speaker corrections, Chinese conversion, Word validation/export, and atomic generation queuing. The AI response contract was tested with a mock; no external AI calls were made.
- Browser verification in the sample workspace confirmed direct speaker renaming updated both matching segments in transcript v3; DOCX upload and template publication succeeded; applying that template created document v2. The AI generation guidance and optional manual-entry state were inspected. At 390 x 844 the speaker editor had no horizontal overflow; the viewport override was reset afterwards.
- The starter and filled Traditional Chinese DOCX were rendered using the Documents skill renderer and LibreOffice in an isolated temporary container. Both one-page renders were visually inspected: text, repeated items, footer/page number and draft/sample label were readable without clipping. Artifacts: `tmp/template-qa/starter-render` and `tmp/template-qa/filled-render`. Arbitrary customer templates and exact Microsoft Word pagination remain template-specific checks.
- Docker Desktop initially failed to start because of stale runtime sockets. Both socket-only runtime folders were preserved as dated `.before-ai-minutes-*` backups and recreated together. Engine startup and application health were then verified. No database/recording volumes, credentials or Docker disk images were deleted.

Operating guide: [AI minutes and Word templates](ai-minutes-and-word-templates.md). Physical phone recording, Tailscale connectivity and live provider end-to-end checks remain pending as described above.

### Local HTTP gateway correction

On September 17, local HTTP gateway origins were enabled explicitly, with Docker loopback routing to `host.docker.internal`. The company Minutes AI base URL was corrected to the user-selected `http://localhost:20128/v1`, retaining its saved key and model. Gateway model discovery and a minimal synthetic JSON completion both returned HTTP 200 with `cx/gpt-5.6-sol`. No meeting transcript was sent in this diagnostic. This verifies live gateway authentication and a small completion, not full meeting generation quality. The frontend Docker build, two endpoint-policy tests and the templates/generation integration suite passed. Authentication errors now identify the endpoint and distinguish HTTP 401 from quota/rate errors.

### September 17: managed Teams and Zoom capture

- Added Recall.ai configuration and a six-step on-screen guide for each platform, including credentials, region, participant name, recording notice, callback setup, host requirements, connection checks and the first meeting.
- Added durable bot dispatch, scheduled/live stop, signed and deduplicated callbacks, tenant-bound lifecycle updates, uncertain-dispatch ID recovery, and completed-MP3 import into the existing transcription/automatic-drafting pipeline. Active capture status refreshes automatically in the meeting workspace.
- Rebuilt and deployed the Docker app. App and PostgreSQL health checks passed. Port 5000 health returned HTTP 200; the callback-only port 5001 returned 404 for application/root routes. All ports remain bound to loopback. No public tunnel was started.
- All 28 automated tests passed: 21 platform/domain/integration checks plus seven recording and Word-template checks. New checks cover raw-body signatures, timestamp expiry, callback deduplication, tenant isolation, readiness gates, dispatch idempotence, recording import, out-of-order events, pending/scheduled cancellation, live leave requests, rejected/uncertain dispatch and readiness reset. Provider responses were mocked; fixtures used isolated synthetic organisations.
- Browser inspection confirmed Teams and Zoom configuration fields, platform-specific numbered instructions and disabled external actions in the sample workspace. Desktop notice wrapping was corrected. The guide fit a 390 × 844 viewport without horizontal overflow (dialog content/client widths both 336px); no browser errors were observed. The viewport override was reset.
- Still pending: a real Recall API key and verification secret, reachable public HTTPS callback, signed provider test delivery, host admission and a real Teams/Zoom recording through to draft minutes. This update does not claim live meeting attendance or high-availability operation. Native self-hosted workers and automatic multi-part recording assembly remain outside the implementation.

Operating guide: [Teams and Zoom remote meetings](remote-meetings.md).

### September 17: two capture configuration methods per platform

- Teams and Zoom each have a configuration-method selector: Recall.ai or Direct integration. Saved credentials/settings are independent. An explicit selection controls new assignments; existing sessions retain their method, and active sessions block switching. Direct selection never silently falls back to Recall.
- Added encrypted direct-worker credentials, provider identity fields, connection/capability verification and a six-step on-screen setup guide for each platform. Teams identifies the Azure Windows requirement; Zoom identifies RTMS and the absence of a participant bot. The separate worker implementation/deployment boundary is displayed before the form.
- Implemented the platform-side `ai-minutes-capture/v1` worker connector: exact-origin policy, stable-ID dispatch, status ordering, idempotent stop contract, authenticated WAV/MP3 import and transcription queuing. Native Microsoft media SDK/Zoom RTMS workers themselves are not bundled or deployed. The adapter contract and external setup are documented in [direct capture](direct-capture.md).
- Docker frontend build and deployment passed; app and database are healthy. All 32 automated tests passed inside Docker, including four new direct configuration/domain/integration tests. Provider and worker HTTP responses were mocked, using isolated synthetic organisations. The direct unit tests also passed locally without a deployment encryption key.
- Browser verification confirmed both Teams options and both Zoom options, correct platform-specific fields, the separate saved selection label, and sample-workspace restrictions. Direct Zoom layout and long configuration instructions were inspected at 390 × 844 with no visible horizontal clipping outside form controls; the viewport was reset. No company capture configuration was changed or external meeting joined.
- Remaining for live direct capture: implement/deploy compatible native workers, configure provider identities, permissions and public event/media endpoints, then perform a consented live meeting test. A successful platform worker-contract test alone does not prove native meeting capture.

