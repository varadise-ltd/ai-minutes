# AI minutes and Word layouts

## Normal operation

1. Record or upload the meeting audio.
2. Choose **Transcribe & generate minutes**. ElevenLabs produces the transcript, Chinese text is converted to Traditional Chinese, and a Minutes AI job is queued automatically.
3. The page updates while processing. Review the generated summary, discussions, decisions, actions and open questions. **Add missing item** is optional correction, not the primary authoring flow.
4. Correct speakers if needed and regenerate the AI draft to use those names. Earlier document versions remain available.
5. Verify source evidence, submit and obtain approval before issuing approved minutes.

Click **Rename** beside any speaker label in the transcript, or **Name speakers** above it. Listen to a sample and enter the person's name once to update all their segments in that meeting. A reviewer can correct a draft. For submitted or approved minutes, an approver can use **Create correction draft**: the previous document stays intact, and the corrected version must go through review/approval again. Speaker names are meeting-specific; this does not enroll voiceprints for future identity recognition.

Both ElevenLabs and Minutes AI need their own configured connections. If drafting fails or Minutes AI is missing, the transcript is retained. Configure Minutes AI under **Administration → Connections**, then use **Generate AI minutes**; there is no need to transcribe the audio again. AI generation does not automatically verify or approve its output.

The first manually imported transcript also queues generation in a real company workspace. Sample workspaces never call external AI services. Source corrections do not trigger unexpected paid regeneration.

## Traditional Chinese

New Chinese transcripts use Hong Kong Traditional Chinese before generation. English terms and timestamps are preserved. Original provider text is retained where conversion changes it. The model is instructed to use Traditional Chinese whenever it writes Chinese; its Chinese output is normalized as well.

Older source records are displayed in Traditional Chinese by default, including submitted and approved meetings. **Show original source text** reveals the stored original. Display conversion does not edit a locked source. Regenerating an editable legacy draft first creates a Traditional Chinese source version and retains the original source/document history.

## Control document appearance in Word

Open **Administration → Templates → Publish template**:

1. Download the starter DOCX, or add the supported placeholders to your company DOCX.
2. Adjust your logo, header/footer, fonts, paragraph styles, tables, margins and page size in Word. Embed images directly.
3. Upload the DOCX (up to 5 MB), select the output language and enter section headings to guide AI content.
4. Use **Validate & download sample PDF** to inspect the layout with synthetic Chinese content.
5. Publish the version. Choose it when creating meetings, or use **Change template** on an editable meeting.

DOCX export fills the uploaded Word package, preserving its styles and layout elements. PDF is rendered from that filled DOCX using LibreOffice in the application container. Word and LibreOffice can differ slightly in pagination; validate your own template's PDF before relying on exact page matching. Fonts unavailable in the container are substituted; Noto CJK and DejaVu are installed. Use these fonts for consistent Chinese output.

Published templates are immutable. New versions do not change previous meeting exports. Applying a different template to an editable meeting creates a document version and retains the current content; regenerate when language or content guidance changes. Submitted/approved minutes must be returned or revised first.

### Supported placeholders

Top-level fields: `{title}`, `{summary}`, `{referenceNumber}`, `{date}`, `{time}`, `{timezone}`, `{attendees}`, `{nextMeeting}`, `{version}`, `{templateName}`, `{status}`. `{date}` and `{time}` use the meeting's scheduled start, selected duration and saved time zone. `{referenceNumber}` is the optional meeting reference number entered during setup.

Use `{#items}` and `{/items}` around the repeated minutes block. Inside it: `{number}`, `{type}`, `{text}`, `{owner}`, `{dueDate}`, `{evidence}`, `{quote}`, `{speaker}`, `{timestamp}`. Each start/end tag should occupy its own paragraph for a paragraph loop. A table-row loop can place its start/end tags in the row's cells, following Docxtemplater's row-loop syntax.

Alternatively use all four section loops: `{#discussions}…{/discussions}`, `{#decisions}…{/decisions}`, `{#actions}…{/actions}`, `{#questions}…{/questions}`. Every item loop must include `{text}`. Top-level `{title}` and `{summary}` are required. The app always inserts a draft/approval label and the sample-data label where applicable.

An ordinary DOCX without placeholders needs those fields added; the app does not guess where an arbitrary document's contents should be replaced. Raw XML, expressions, macros, external links, embedded documents and nested loops are rejected. Templates are stored privately in the company database and are never sent to the AI provider; only their text guidance is sent.

References: [OpenCC Chinese conversion](https://github.com/nk2028/opencc-js), [Docxtemplater configuration](https://docxtemplater.com/docs/configuration/).
