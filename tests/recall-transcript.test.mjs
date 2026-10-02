import test from 'node:test';
import assert from 'node:assert/strict';
import { recallAsyncTranscriptRequest, recallTranscriptSegments } from '../services/api/capture-domain.mjs';

test('Recall post-meeting transcription requests participant attribution and preserves names', () => {
  assert.deepEqual(recallAsyncTranscriptRequest(), {
    provider: { recallai_async: { language_code: 'auto' } },
    diarization: { use_separate_streams_when_available: true }
  });
  const segments = recallTranscriptSegments([{ participant: { id: 17, name: 'Terence Chan' }, words: [
    { text: 'Hello', start_timestamp: { relative: 1.2 }, end_timestamp: { relative: 1.5 } },
    { text: 'everyone.', start_timestamp: { relative: 1.5 }, end_timestamp: { relative: 2.1 } }
  ] }, { participant: { id: 24, name: '陳小姐' }, words: [
    { text: '你', start_timestamp: { relative: 3 }, end_timestamp: { relative: 3.2 } },
    { text: '好', start_timestamp: { relative: 3.2 }, end_timestamp: { relative: 3.5 } }
  ] }]);
  assert.deepEqual(segments.map(({speaker,speakerId,start,end,text})=>({speaker,speakerId,start,end,text})), [
    { speaker: 'Terence Chan', speakerId: 'recall-17', start: 1.2, end: 2.1, text: 'Hello everyone.' },
    { speaker: '陳小姐', speakerId: 'recall-24', start: 3, end: 3.5, text: '你好' }
  ]);
});
