# Prototype Instructions

Chinese transcripts and Chinese minutes must use Traditional Chinese. The primary flow is transcription followed by automatic AI minutes generation, then human review. Manual item entry is an optional correction. Document appearance must support an uploaded, versioned Word layout template; retain earlier minutes and source versions.

Teams and Zoom must each offer two capture configuration options with detailed numbered setup instructions: Recall.ai, or a direct/self-hosted integration. Preserve settings separately and show the selected method. Direct Teams uses an Azure Windows media worker; direct Zoom uses RTMS without a named participant bot. Distinguish configured, verified, admitted/host-authorised and actively recording states. Never fall back to a chargeable method silently, or imply native workers are installed merely because configuration was saved.

Transcription preference: a Teams or Zoom meeting joined by the Recall.ai bot uses Recall.ai post-meeting transcription and participant attribution. Phone/browser microphone recordings, uploaded recordings and direct/self-hosted capture use ElevenLabs. This routing is automatic and must not be exposed as a per-meeting provider toggle.

Administration includes company-scoped Brand settings for platform logo, name, fonts and colour tone, with a live preview and explicit Save. Keep document-export layout controlled by the versioned Word templates. Branding must preserve semantic status colours, tenant isolation and readable button/navigation text.

Every signed-in user can reach My account from the sidebar or their own People & access row to edit their display name and change their local password. Keep self-service profile changes separate from access administration; users cannot change their own roles or deactivate themselves. Microsoft-only passwords remain managed by their sign-in provider.

New local passwords require 8–200 characters with at least one uppercase letter, one lowercase letter and one number. Apply this to company setup, Add user and password changes; existing passwords remain valid for sign-in.

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
