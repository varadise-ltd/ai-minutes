import test from 'node:test';
import assert from 'node:assert/strict';
import {traditional,traditionalSegments,traditionalMinutes} from '../packages/domain/chinese.mjs';

test('Traditional Chinese conversion preserves English and speaker/timing identity',()=>{
  const original={id:'s1',speaker:'speaker_0',speakerId:'speaker_0',start:12,end:17,text:'会议讨论开发进度，确认负责人。API deadline 2026-09-20'};
  const [result]=traditionalSegments([original]);
  assert.equal(result.text,'會議討論開發進度，確認負責人。API deadline 2026-09-20');
  assert.equal(result.originalText,original.text);
  for(const key of ['id','speaker','speakerId','start','end'])assert.equal(result[key],original[key]);
  assert.deepEqual(traditionalSegments([result]),[result]);
  assert.equal(original.text,'会议讨论开发进度，确认负责人。API deadline 2026-09-20');
  assert.equal(traditional('We will review the API.'),'We will review the API.');
});
test('Chinese draft and exact evidence quote use the same canonical conversion',()=>{
  const source='确认下周提交报告。';
  const draft=traditionalMinutes({summary:'会议摘要',attendees:['陈先生'],items:[{type:'action',text:'提交报告',quote:source,evidence:'s1',owner:'陈先生',dueDate:'',verified:false}]});
  assert.equal(draft.items[0].quote,traditionalSegments([{id:'s1',text:source}])[0].text);
  assert.equal(draft.items[0].verified,false);assert.equal(draft.items[0].evidence,'s1');
});
