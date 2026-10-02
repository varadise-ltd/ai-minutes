import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';import pg from 'pg';import PizZip from 'pizzip';
import {starterDocx} from '../../services/api/docx-templates.mjs';
import {saveTranscription} from '../../services/api/minutes-workflow.mjs';
import {encrypt,generateMinutes} from '../../services/api/providers.mjs';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),base=process.env.TEST_URL||'http://127.0.0.1:5000';

test('Word layouts are validated, tenant scoped, versioned and used for matching DOCX/PDF exports; transcription queues generation atomically',async()=>{
 const org=randomUUID(),other=randomUUID(),admin=randomUUID(),member=randomUUID(),outsider=randomUUID(),unit=randomUUID(),orgs=[org,other];
 async function session(id){const token=randomBytes(32).toString('hex');await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),id]);return 'minutes_session='+token;}
 async function request(url,method='GET',body,cookie){const r=await fetch(base+'/api'+url,{method,headers:{Cookie:cookie||'',...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});return{status:r.status,data:(r.headers.get('content-type')||'').includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};}
 try{
  for(const id of orgs)await pool.query('INSERT INTO organizations(id,name,demo) VALUES($1,$2,true)',[id,'Template test '+id]);
  for(const [id,o,roles] of [[admin,org,['ORG_ADMIN']],[member,org,['MEMBER']],[outsider,other,['ORG_ADMIN']]])await pool.query('INSERT INTO users(id,org_id,name,email,roles) VALUES($1,$2,$3,$4,$5)',[id,o,'Template tester',id+'@example.invalid',roles]);
  await pool.query("INSERT INTO units(id,org_id,name,kind) VALUES($1,$2,'Template test','team')",[unit,org]);await pool.query('UPDATE users SET unit_ids=$2 WHERE id=$1',[member,[unit]]);
  const a=await session(admin),b=await session(member),c=await session(outsider),word=await starterDocx();
  function form(buffer=word){const f=new FormData();f.set('name','Company Word layout');f.set('language','Traditional Chinese');f.set('sections',JSON.stringify(['討論','決議','跟進事項']));f.set('file',new Blob([buffer]),'company.docx');return f;}
  assert.equal((await request('/templates','POST',form(),b)).status,403);
  assert.equal((await request('/templates','POST',form(Buffer.from('bad')),a)).status,400);
  const uploaded=await request('/templates','POST',form(),a);assert.equal(uploaded.status,201);const tid=uploaded.data.id;
  const list=(await request('/templates','GET',null,a)).data;assert.equal(list.length,1);assert.equal(list[0].docx_name,'company.docx');assert.equal(list[0].docx_data,undefined);
  assert.equal((await request(`/templates/${tid}/docx`,'GET',null,c)).status,404);
  const created=await request('/meetings','POST',{title:'Word template test',scheduledAt:new Date().toISOString(),unitId:unit,templateId:tid,consent:true},a);const id=created.data.id;
  let m=(await request('/meetings/'+id,'GET',null,a)).data;
  assert.equal((await request(`/meetings/${id}/transcript`,'PUT',{revision:m.revision,segments:[{id:'s1',speaker:'陈先生',start:2,text:'会议讨论开发进度。'}]},a)).status,200);
  m=(await request('/meetings/'+id,'GET',null,a)).data;assert.equal(m.transcripts[0].segments[0].text,'會議討論開發進度。');assert.equal(m.transcripts[0].segments[0].originalText,'会议讨论开发进度。');assert.equal(m.minutes[0].template_snapshot.id,tid);
  const content={summary:'討論項目進度。',attendees:['陳先生'],items:[{type:'discussion',text:'討論開發進度。',evidence:'s1',quote:'會議討論開發進度。',owner:'',dueDate:'',verified:false}]};
  await pool.query("INSERT INTO integrations(org_id,provider,config,secret) VALUES($1,'Minutes AI',$2,$3)",[org,{model:'test-model'},encrypt('synthetic-test-key')]);
  const realFetch=globalThis.fetch;try{
    globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/chat/completions');const body=JSON.parse(options.body);const input=JSON.parse(body.messages[1].content);assert.equal(input.segments[0].text,'會議討論開發進度。');assert.equal(input.segments[0].originalText,undefined);assert.match(body.messages[0].content,/Traditional Chinese/);return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({...content,summary:'会议讨论进度。',items:[{...content.items[0],text:'讨论开发进度。',quote:'会议讨论开发进度。',verified:true}]})}}]})};};
    const generated=await generateMinutes(m,m.transcripts[0].segments,{language:'Traditional Chinese'});assert.equal(generated.summary,'會議討論進度。');assert.equal(generated.items[0].quote,'會議討論開發進度。');assert.equal(generated.items[0].verified,false);
    globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"summary":"","items":[]}'}}]})});await assert.rejects(()=>generateMinutes(m,m.transcripts[0].segments,{}),/no substantive minutes/);
  }finally{globalThis.fetch=realFetch;}
  assert.equal((await request(`/meetings/${id}/minutes`,'PUT',{revision:m.minutes[0].revision,content},a)).status,200);
  const docx=await request(`/meetings/${id}/export/docx`,'GET',null,a);assert.equal(docx.status,200);assert.match(new PizZip(docx.data).file('word/document.xml').asText(),/討論開發進度/);
  const pdf=await request(`/meetings/${id}/export/pdf`,'GET',null,a);assert.equal(pdf.status,200);assert.equal(pdf.data.subarray(0,4).toString(),'%PDF');
  const next=await request('/templates','POST',{name:'Company Word layout',language:'Traditional Chinese',sections:['討論'],sourceTemplateId:tid},a);assert.equal(next.status,201);
  const retained=(await request('/meetings/'+id,'GET',null,a)).data;assert.equal(retained.minutes[0].template_snapshot.id,tid);
  assert.equal((await request(`/meetings/${id}/template`,'PUT',{templateId:next.data.id,revision:retained.revision},b)).status,403);
  assert.equal((await request(`/meetings/${id}/template`,'PUT',{templateId:next.data.id,revision:retained.revision},a)).status,200);
  m=(await request('/meetings/'+id,'GET',null,a)).data;assert.equal(m.minutes[0].template_snapshot.id,next.data.id);assert.equal(m.minutes[1].template_snapshot.id,tid);
  assert.equal((await request(`/meetings/${id}/traditional-chinese`,'POST',{revision:m.revision},a)).data.changed,false);
  const oldSource=m.transcripts[0].id;
  await pool.query('UPDATE transcripts SET segments=$2 WHERE id=$1',[oldSource,JSON.stringify([{id:'s1',speaker:'陳先生',start:2,text:'会议讨论开发进度。'}])]);
  m=(await request('/meetings/'+id,'GET',null,a)).data;
  assert.equal(m.transcripts[0].segments[0].text,'会议讨论开发进度。');
  assert.equal(m.transcripts[0].segments[0].displayText,'會議討論開發進度。');
  assert.equal((await request(`/meetings/${id}/traditional-chinese`,'POST',{revision:m.revision},a)).data.changed,true);
  m=(await request('/meetings/'+id,'GET',null,a)).data;
  assert.equal(m.transcripts[0].segments[0].text,'會議討論開發進度。');assert.equal(m.transcripts[1].id,oldSource);assert.equal(m.transcripts[1].segments[0].text,'会议讨论开发进度。');
  assert.equal((await request(`/meetings/${id}/actions/submit`,'POST',{revision:m.revision},a)).status,200);
  m=(await request('/meetings/'+id,'GET',null,a)).data;
  assert.equal((await request(`/meetings/${id}/traditional-chinese`,'POST',{revision:m.revision},a)).status,409);
  assert.equal((await request(`/meetings/${id}/template`,'PUT',{templateId:tid,revision:m.revision},a)).status,409);
  const client=await pool.connect();try{await client.query('BEGIN');await saveTranscription(client,m,[{id:'s1',start:0,speaker:'speaker_0',text:'会议决定整理报告。'}]);const state=(await client.query('SELECT status FROM meetings WHERE id=$1',[id])).rows[0];assert.equal(state.status,'GENERATING_MINUTES');const queued=(await client.query("SELECT type FROM jobs WHERE meeting_id=$1 AND status='PENDING'",[id])).rows;assert.deepEqual(queued,[{type:'GENERATE'}]);const source=(await client.query('SELECT segments FROM transcripts WHERE meeting_id=$1 ORDER BY version DESC LIMIT 1',[id])).rows[0];assert.equal(source.segments[0].text,'會議決定整理報告。');}finally{await client.query('ROLLBACK');client.release();}
 }finally{
  for(const table of ['audit','rate_cards','integrations','oauth_states'])await pool.query(`DELETE FROM ${table} WHERE org_id=ANY($1::uuid[])`,[orgs]);await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id=ANY($1::uuid[]))',[orgs]);for(const table of ['jobs','usage','minutes','transcripts'])await pool.query(`DELETE FROM ${table} WHERE meeting_id IN (SELECT id FROM meetings WHERE org_id=ANY($1::uuid[]))`,[orgs]);for(const table of ['meetings','templates','users','units','organizations'])await pool.query(`DELETE FROM ${table} WHERE ${table==='organizations'?'id':'org_id'}=ANY($1::uuid[])`,[orgs]);await pool.end();
 }
});
