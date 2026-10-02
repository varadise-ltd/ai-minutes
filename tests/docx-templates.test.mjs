import test from 'node:test';import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import {starterDocx,validateDocxTemplate,renderDocxTemplate,sampleTemplateData,templateData} from '../services/api/docx-templates.mjs';

test('Word template retains layout and fills Chinese, loop items and approval label',async()=>{
  const original=await starterDocx(),before=new PizZip(original);
  assert.ok(validateDocxTemplate(original).includes('items'));
  const rendered=new PizZip(renderDocxTemplate(original,sampleTemplateData()));
  const xml=rendered.file('word/document.xml').asText();
  assert.match(xml,/項目協調會議/);assert.match(xml,/M003_2026/);assert.match(xml,/2026 年 9 月 16 日/);assert.match(xml,/10:00 - 11:00/);assert.match(xml,/整理文件清單/);assert.match(xml,/草稿 — 未經批准/);assert.match(xml,/SAMPLE DATA/);assert.doesNotMatch(xml,/\{#items\}|\{summary\}/);
  assert.equal(rendered.file('word/styles.xml').asText(),before.file('word/styles.xml').asText());
  assert.equal(rendered.file('word/footer1.xml').asText(),before.file('word/footer1.xml').asText());
});
test('template data supplies the configured reference number and local meeting time range',()=>{
  const data=templateData({title:'Test',reference_number:'M003_2026',scheduled_at:'2026-09-16T02:00:00Z',timezone:'Asia/Hong_Kong',duration_minutes:90},{version:1,status:'DRAFT',template_snapshot:{language:'Traditional Chinese'},content:{summary:'Summary',attendees:[],items:[]}},[]);
  assert.equal(data.referenceNumber,'M003_2026');assert.equal(data.date,'2026 年 9 月 16 日');assert.equal(data.time,'10:00 - 11:30');
});
test('template validation rejects non-DOCX, missing fields, unsafe XML and invalid tags',async()=>{
  assert.throws(()=>validateDocxTemplate(Buffer.from('not a docx')),/readable DOCX/);
  const original=await starterDocx();
  const changed=edit=>{const zip=new PizZip(original);zip.file('word/document.xml',edit(zip.file('word/document.xml').asText()));return zip.generate({type:'nodebuffer'})};
  assert.throws(()=>validateDocxTemplate(changed(x=>x.replace('{summary}','Nothing'))),/summary/);
  assert.throws(()=>validateDocxTemplate(changed(x=>x.replace('{text}','{unknownField}'))),/invalid|Unsupported/);
  assert.throws(()=>validateDocxTemplate(changed(x=>x.replace('{summary}','{@summary}'))),/Raw XML/);
  assert.throws(()=>validateDocxTemplate(changed(x=>x.replace('{text}','{#items}{text}{/items}'))),/Nested|invalid/);
  const zip=new PizZip(original);zip.file('word/vbaProject.bin',Buffer.from('fake'));assert.throws(()=>validateDocxTemplate(zip.generate({type:'nodebuffer'})),/macros/);
});
