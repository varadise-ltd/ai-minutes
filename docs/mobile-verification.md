# Recording and speaker editing verification

Verified on 16 September 2026 against the rebuilt `ai-minutes` Docker application at `http://localhost:5000`. App and database were healthy after deployment; their existing volumes were retained.

## Automated checks

All 17 tests passed in the final container with:

```text
docker compose exec -T app node --test --test-concurrency=1 tests/domain.test.mjs tests/recording.test.mjs tests/speakers.test.mjs tests/integration/platform.test.mjs tests/integration/capture.test.mjs
```

Recording tests use an injected recorder and media stream to exercise format selection, final chunk assembly, pause/resume duration, permission failures, stream cleanup, interrupted recording and unexpected stops. They do not prove physical-device codec or background behavior.

Speaker tests check naming, individual reassignment, new speaker splitting, invalid input and preservation of source IDs, text and timestamps. The API integration suite uses isolated test organisations and a synthetic WAV file; it checks role/tenant access, upload conflicts, audio range responses, optimistic transcript conflicts, source version retention, verification reset and locked submitted/approved sources. Test organisations are cleaned up.

An initial parallel run encountered a transient database authentication timeout and API connection failure. The isolated capture rerun passed, followed by the complete sequential 17-test run passing. No external provider calls were made.

## Browser checks

- Created clearly labelled sample meetings through **Record a meeting** and reached the recorder.
- Confirmed Start recording is disabled until participant-notice consent is checked.
- Renamed two speakers to synthetic names, reassigned one segment and saved through the UI. Transcript version advanced to 2 and the new names/assignment persisted.
- Checked recorder and speaker editor at 390 x 844: page client width and scroll width both 375 px, with no horizontal overflow. The speaker dialog also had matching client/scroll widths.
- No browser console errors were observed after final checks. No physical microphone was activated.

Screenshot evidence is intentionally omitted from this public source import.

## Remaining verification

Tailscale is installed but reported `NeedsLogin`; login attempts received HTTP 502 from the coordination service. No private phone URL has been enabled. After the user signs in on the PC and phone, run `scripts/enable-phone-access.ps1 -CheckOnly`, then the script without `-CheckOnly` to configure the exact HTTPS origin and private Serve endpoint. The script disables the shared sample workspace for remote access and preserves existing company data.

Physical iPhone/Android capture, IndexedDB recovery after a real mobile interruption, private HTTPS microphone permission, and live ElevenLabs upload-to-transcript processing still require device/account validation. Keep the phone unlocked and the browser foregrounded; operating systems may interrupt background audio. Speaker naming is a reviewer-confirmed label within a meeting, not cross-meeting biometric identification.
