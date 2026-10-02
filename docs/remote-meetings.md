# Teams and Zoom minutes taker

Use **Administration → Connections → Teams or Zoom → Configure & setup guide**. Each platform has two configuration methods: Recall.ai, or a direct/self-hosted worker. Use the **Configuration method** selector to view each form, then **Use direct integration** or **Use Recall.ai** to select the method for new assignments. Saving credentials alone does not switch methods. Both sets of saved settings are retained; unsaved edits are discarded when changing panels. The direct option never falls back to Recall.

For direct Teams/Zoom setup and the worker deployment boundary, see [direct capture](direct-capture.md). The steps below cover Recall.ai, which joins as a named participant. Configure each platform separately, even when both use the same Recall workspace. Meeting audio is processed by Recall, then Recall creates the participant-attributed post-meeting transcript and Minutes AI prepares the draft. Recall charges are billed separately and are not in the app's cost ledger. Local microphone, uploaded and direct/self-hosted recordings continue to use ElevenLabs transcription.

## 1. Create a Recall workspace

Sign in at [Recall.ai](https://www.recall.ai/). Confirm billing and meeting-bot access. Select the workspace region in the app. The API key and webhook endpoint must belong to that region. Open the guide's **Developers → API keys** link, create a key, and paste it into **Recall API key**. Set the visible participant name and recording notice.

## 2. Connect the callback listener

Docker publishes a dedicated callback receiver at `http://localhost:5001`. It has no application UI or login routes. Keep this computer, Docker and the public proxy running during meetings and processing.

Use an approved HTTPS reverse proxy with a stable hostname, or follow [ngrok's setup guide](https://ngrok.com/docs/getting-started/). Install its official client, run the authentication command shown in your ngrok account, then run `ngrok http 5001`. Copy the stable HTTPS URL assigned to your account into **Public callback base URL**. Do not forward port 5000 for this integration. Private Tailscale addresses cannot receive Recall callbacks.

In Recall **Webhooks → Add endpoint**, paste the complete generated **Teams webhook endpoint** or **Zoom webhook endpoint** shown in the app. Subscribe to the ten events listed on screen. Paste the `whsec_` verification secret into the app. Modern Recall accounts use the workspace verification secret; accounts created before 15 December 2025 use the endpoint signing secret. Follow the linked [verification guide](https://docs.recall.ai/docs/authenticating-requests-from-recallai) for your account.

## 3. Prepare the meeting host

- **Teams:** copy the full invitation join link. Confirm tenant policy allows the bot. The host admits it from the lobby. If sign-in is required, complete Recall's [signed-in Teams configuration](https://docs.recall.ai/docs/setting-up-signed-in-bots-for-microsoft-teams). This connector does not supply per-meeting authenticated-bot tokens. Teams channel meetings do not support the normal chat notice; notify participants directly.
- **Zoom:** use a standard meeting and copy the full link including its passcode parameter. The host starts the meeting, admits the bot and grants recording permission when requested. Sign-in/registration-required meetings may need additional provider setup; ZAK/OBF token callbacks are not implemented here. See [Zoom restrictions](https://docs.recall.ai/docs/zoom-overview).

Confirm participant consent before recording. Bot admission does not itself confirm recording has started.

## 4. Save and verify

Check the acknowledgement, enable capture and click **Save configuration**. Click **Test API connection**; it only checks API access and never joins a meeting. In Recall's endpoint page, send a signed test event. Click **Refresh checks**. API key and Callback must both show **Verified**, with Assignments **Ready**. Changing keys, region or callback URL resets readiness. Changes to those fields are blocked while captures are active.

## 5. Assign a minutes taker

Configure Minutes AI first. On **Today → Add a minutes taker**, paste the meeting link, select time/team/template and confirm consent. New assignments with ready connections automatically dispatch. Schedule at least ten minutes ahead when possible. For an existing setup-required assignment, open its meeting workspace and choose **Send minutes taker**.

The workspace distinguishes Scheduled, Joining, Waiting for admission, Joined but not recording, Capturing, Stopping and Processing. Only **Capturing** reflects the provider's active-recording event. **Stop minutes taker** cancels an unsent/scheduled bot or requests a live bot to leave; active-call termination is confirmed asynchronously.

## 6. Review the result

When Recall reports a completed recording, the app downloads its mixed MP3, queues Recall post-meeting transcription and then generates the AI draft. Chinese text remains Traditional Chinese. Correct speaker names, inspect evidence, edit and approve as usual. Start with a short consented test meeting before relying on a longer meeting.

## Recovery and limits

- **Dispatch uncertain:** inspect the Recall dashboard. If a bot exists, copy its ID to **Recover bot ID**. The server checks meeting ownership. Do not create another bot until you know the first result; uncertain create requests are not blindly repeated.
- **API rejects dispatch:** correct the key/account, repeat connection checks and use **Retry minutes taker**. Failed create requests that definitely produced no bot can be retried.
- **Import fails:** check the provider recording, then click **Retry recording import**. Expired download links are refreshed through the recording API.
- Only one completed recording part, up to 250 MB, is imported per assignment. Additional parts remain in Recall and require manual review/export. Multi-part merging and recovery of partial provider recordings are not implemented.
- The callback worker retains failed events and retries up to five times; there is no automatic incident notification or administrator replay screen. Check server logs and Recall's delivery dashboard when progress stops.
- A process restart does not recreate an uncertain bot. Interrupted capture import/stop operations require explicit retry from the meeting workspace. This local deployment is not a high-availability capture service.

Implementation tests use synthetic organisations and mocked provider responses. Actual Recall account configuration, public callback delivery and live Teams/Zoom attendance must be verified with your account.
