# Provider setup and verification

## Microsoft 365

Create a single-tenant Entra application for this company. Add a Web redirect URI matching `PUBLIC_URL` plus `/api/auth/microsoft-callback`. For local development this is `http://localhost:5000/api/auth/microsoft-callback`.

Save tenant ID, client ID and client secret in Administration → Connections. Secrets are encrypted using the installation key. Basic sign-in requests `openid profile email` and uses state, nonce and PKCE. Directory and calendar access use separate application permissions; they are not requested by the sign-in screen.

Directory sync needs Microsoft Graph `User.Read.All` application permission and administrator consent. Optional calendar import needs `Calendars.Read` application permission; restrict permitted mailboxes using Exchange application access controls. The UI imports only the signed-in user's next 30 days and does not automatically record or create capture assignments.

Click **Sync Microsoft 365**. All directory pages must succeed before removed identities are disabled. Accounts are retained, sessions revoked and history preserved. Newly synced members have no team scopes until an administrator assigns them. Identities use tenant ID plus object ID. A conflicting existing local email is not silently linked; resolve the local-account conflict deliberately before sync. Deleted/disabled users cannot sign in. The initial local administrator remains a recovery account.

Current sync is manual, a complete directory read rather than a delta subscription. There is no automatic background sync schedule. Test with a non-production tenant before enabling company-wide use.

Official sources: [MSAL confidential client](https://learn.microsoft.com/en-us/javascript/api/%40azure/msal-node/confidentialclientapplication?view=msal-js-latest), [Graph user delta behaviour](https://learn.microsoft.com/en-us/graph/api/user-delta?view=graph-rest-1.0).

## ElevenLabs

Use a server-side API key with speech-to-text access. Save the key and model ID (`scribe_v2` by default). Upload an authorised recording, then explicitly select **Transcribe recording**. The server sends the file as multipart form data to `/v1/speech-to-text`, requests diarisation and groups returned words into timestamped segments. Provider errors leave an actionable failure state. No automated retry repeats a potentially chargeable request after a process restart.

Cost quantity is currently derived from the final returned word end time, not invoice-measured file duration. Silence or rounding can make it differ from billed audio duration. The cost display is calculated usage, not exact billed spend; reconcile provider billing before treating it as accounting truth.

Official source: [Create transcript](https://elevenlabs.io/docs/api-reference/speech-to-text/convert).

## Minutes AI

Configure an OpenAI-compatible `/chat/completions` service, exact model ID and API key from the same service. The model must support JSON-object responses. HTTPS hosts default to `api.openai.com` and `openrouter.ai`; deployments can change `LLM_ALLOWED_HOSTS`. Redirects are rejected.

Local HTTP gateways are supported. For OmniRoute on this computer, enter `http://localhost:20128/v1`. Docker Compose maps loopback requests to `http://host.docker.internal:20128/v1`; the saved URL remains recognisable to the user. The saved key is sent to that gateway, not directly to OpenAI.

Other HTTP gateways require their exact origin (scheme, host and port) in `LLM_ALLOWED_HTTP_ORIGINS`, for example `http://gateway:8080`. Defaults permit localhost, 127.0.0.1, ::1 and host.docker.internal on port 20128. An explicitly empty value disables HTTP. Restart/recreate the app after changing deployment settings. HTTP is unencrypted, so use it for trusted local/private gateways; use HTTPS across untrusted networks. URLs containing embedded credentials, query parameters or fragments are rejected. Keep API keys in the separate encrypted credential field.

HTTP 401 means the endpoint rejected authentication: confirm the key belongs to that endpoint. HTTP 429 indicates a rate/quota limit. A successful model-list check confirms gateway authentication and model listing, but does not prove generation succeeds against its upstream provider.

The request carries the final transcript, meeting title and template. Treat transcripts as untrusted text. Generation creates an unapproved draft. The validator checks source references, exact quotes and explicit owner/date evidence. A human must verify the meaning of each decision/action; no claim of automatic semantic proof is made. Failed or unusable provider responses may still incur costs outside the successful usage ledger.

Enter separate rate rows for one million input tokens and one million output tokens. Model IDs must match configuration exactly. Missing rates produce a visible incomplete-cost state. Every successful usage row freezes the effective USD price and HKD exchange rate; editing rates never silently reprices earlier records.

## Teams and Zoom capture

Both platforms offer **Recall.ai** and **Direct integration** in their configuration-method selector. The selected method applies to new captures; existing sessions keep their original method. Switching during active captures is blocked. Direct settings and a tested worker connector are included; native Teams/Zoom media workers still require separate implementation and deployment. See the [direct configuration and worker contract](direct-capture.md).

The runnable app includes a **Recall.ai managed meeting-bot connector** for both platforms. Open **Administration → Connections → Teams or Zoom → Configure & setup guide**. Each screen includes six numbered steps, encrypted credential fields, a generated callback URL, platform-specific host requirements, connection checks and a first-meeting walkthrough. Follow [remote meeting setup](remote-meetings.md) for the same operating sequence.

Assignments stay `SETUP_REQUIRED` until enabled configuration, an accepted API check and a correctly signed callback are present. Ready new assignments dispatch automatically; older assignments have a **Send minutes taker** button. Recording is shown only after the provider's active-recording event. The meeting workspace exposes stop, uncertain-dispatch bot-ID recovery and failed-import retry controls. Completed MP3 audio enters the existing ElevenLabs → Traditional Chinese transcript → AI draft → human-review pipeline.

Only the callback listener on port 5001 needs a public HTTPS hostname. Port 5000 remains the private application. Callbacks verify raw-body signatures and timestamps, deduplicate delivery IDs, and bind events to organisation, platform and bot. Keys never return to the browser. When Recall sends `bot.done`, the app retrieves that bot once and writes a **Recall.ai / meeting_bot / Recall bot active minute** usage row. This measures `joining_call` through `done`, including waiting-room time, rather than the imported MP3 duration. Add a matching `bot_minute` rate card in Administration → Rates. Existing `audio_minute` Recall rate cards are retained but do not price bot-runtime usage. The per-meeting cost view groups every recorded provider and shows a subtotal plus the overall total. Reconcile the provider invoice before using calculated values for accounting.

Live bot attendance remains unverified until the user supplies a Recall account/key and public callback connection, passes both checks, and runs a consented test meeting. Standard Zoom and Teams meeting support and restrictions follow [Recall Zoom documentation](https://docs.recall.ai/docs/zoom-overview) and [Recall Teams documentation](https://docs.recall.ai/docs/microsoft-teams).

Native self-hosted workers are not part of this connector. Teams native media hosting separately requires Azure Windows and Microsoft-supported application-hosted media components: [Microsoft requirements](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/calls-and-meetings/requirements-considerations-application-hosted-media-bots).
