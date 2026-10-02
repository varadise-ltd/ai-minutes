# Phone recording and speaker review

Use Safari on iPhone or Chrome on Android at a trusted HTTPS address. The same recorder works on a desktop browser at localhost. This is foreground browser recording, not a native iPhone/Android application or background recorder. Calls, screen locking and switching apps can interrupt capture.

## Private phone access

Tailscale is the chosen connection. Sign in to the same Tailscale network on this PC and the phone. Create the platform's company administrator before sharing access.

From PowerShell in the project directory, run `./scripts/enable-phone-access.ps1 -CheckOnly`, then `./scripts/enable-phone-access.ps1`. Use an administrator PowerShell if the Tailscale service denies access. The script checks for existing port 8443 services, reads the actual device hostname, sets the exact permitted HTTPS origin, disables the shared demo workspace and recreates only the app container. It then enables a private Tailscale Serve endpoint on port 8443. It does not enable public Funnel access or publish the database.

If Tailscale requests HTTPS enablement, complete its account-side approval. Open the URL printed by the script on the phone and sign in with your AI Minutes email and password. Tailscale membership does not replace the platform's authorization. Existing tailnet access rules determine which devices can reach the service. Microsoft sign-in redirects still use PUBLIC_URL; use the local account on the phone until your Microsoft redirect configuration is updated deliberately.

The implementation session encountered a Tailscale control-server HTTP 502 before sign-in. The phone URL cannot be generated or tested until the PC is connected. No certificate warning should be bypassed.

## Record and upload

1. Select **Record a meeting**, fill in its title/team/template, and continue to the recorder. Existing empty meetings also have **Record audio** in their workspace.
2. Confirm participants have been informed, press **Start recording**, and allow microphone access.
3. Keep the page visible and phone unlocked. Pause/resume when needed, then stop.
4. Listen to playback. Download a copy if needed, then upload. Upload progress is shown; failed/cancelled uploads retain the local audio for retry.
5. Choose **Transcribe recording** after upload. A real company workspace and configured ElevenLabs account are required. Then name speakers before generating minutes.

Supported browser formats are detected at runtime (WebM/Opus, MP4 audio, or Ogg). Recording stops around 240 MB; the server upload limit is 250 MB. The app releases microphone tracks on stop and unmount. Microphone errors have actionable messages.

Recorded chunks are saved to IndexedDB when available, scoped by company, user and meeting. Reopen the same meeting from the same browser and origin and choose Record audio to recover an unsent recording. A new hostname or different browser cannot access that local copy. Recovery after forced closure may be incomplete or unplayable depending on the browser/format; playback and a downloaded backup are essential. Storage failure is shown. This local cache is not encrypted by the app and remains on the device until uploaded or explicitly discarded; use a private device/browser profile.

## Name and correct speakers

Open a draft meeting and select **Name & correct speakers**. Name each detected speaker once; the name applies across that meeting. Listen to up to 12 seconds of a speaker sample or play a segment. Filter/search segments and select the correct person for any incorrect assignment. Use **Add another speaker** when diarization grouped two people together.

Saving creates a new transcript version, preserving prior versions, segment IDs, text, timestamps and original diarization identity. Draft evidence verification is cleared. Existing minutes text is retained, so regenerate or review it for old names and then verify its evidence again. Approved and submitted versions cannot have speakers changed; create a revision or return the draft first. This feature does not learn voiceprints or identify people across future meetings.

## Reference documentation

- [Browser MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [Microphone secure-context requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
