import { randomUUID } from 'node:crypto';
import { traditionalSegments, traditionalMinutes } from '../../packages/domain/chinese.mjs';

export async function newMinutes(db, meeting, transcriptId, content) {
  const template = (await db.query('SELECT id,name,version,language,sections,docx_name FROM templates WHERE id=$1 AND org_id=$2', [meeting.template_id, meeting.org_id])).rows[0] || {};
  const version = (await db.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM minutes WHERE meeting_id=$1', [meeting.id])).rows[0].version;
  await db.query('INSERT INTO minutes(id,meeting_id,version,transcript_id,content,template_snapshot) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), meeting.id, version, transcriptId, content, template]);
}

export async function saveTranscription(db, meeting, rawSegments, source='ElevenLabs · Traditional Chinese normalized') {
  const version = (await db.query('SELECT COALESCE(MAX(version),0)+1 AS v FROM transcripts WHERE meeting_id=$1', [meeting.id])).rows[0].v;
  const transcriptId = randomUUID();
  await db.query('INSERT INTO transcripts(id,meeting_id,version,segments,source) VALUES($1,$2,$3,$4,$5)', [transcriptId, meeting.id, version, JSON.stringify(traditionalSegments(rawSegments)),source]);
  await newMinutes(db, meeting, transcriptId, { summary: '', attendees: [], items: [] });
  // Queue in the same transaction as the source. A generation failure retains
  // the transcript and can be retried without retranscribing/charging for audio.
  await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'GENERATE')", [randomUUID(), meeting.id]);
  await db.query("UPDATE meetings SET status='GENERATING_MINUTES',revision=revision+1,error=NULL WHERE id=$1", [meeting.id]);
}

export async function normalizeStoredTranscript(db, meeting) {
  const previous = (await db.query('SELECT * FROM transcripts WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1', [meeting.id])).rows[0];
  if (!previous) return false;
  const segments = traditionalSegments(previous.segments);
  if (segments.every((s, i) => s.text === previous.segments[i].text)) return false;
  const transcriptId = randomUUID();
  await db.query("INSERT INTO transcripts(id,meeting_id,version,segments,source) VALUES($1,$2,$3,$4,'Traditional Chinese conversion')", [transcriptId, meeting.id, previous.version + 1, JSON.stringify(segments)]);
  const doc = (await db.query('SELECT * FROM minutes WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1 FOR UPDATE', [meeting.id])).rows[0];
  if (doc) {
    const content = traditionalMinutes(doc.content);
    content.items = content.items.map(item => ({ ...item, verified: false }));
    await newMinutes(db, meeting, transcriptId, content);
  }
  await db.query('UPDATE meetings SET revision=revision+1 WHERE id=$1', [meeting.id]);
  return true;
}
