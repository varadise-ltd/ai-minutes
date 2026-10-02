import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';import {unlink} from 'node:fs/promises';import pg from 'pg';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL}),base=process.env.TEST_URL||'http://127.0.0.1:5000';
test('audio upload and speaker editing preserve versions, evidence and tenant boundaries',async()=>{
 const org=randomUUID(),other=randomUUID(),admin=randomUUID(),member=randomUUID(),outsider=randomUUID(),unit=randomUUID(),template=randomUUID(),orgs=[org,other];let audioPath;
 async function session(id){const token=randomBytes(32).toString('hex');await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),id]);return 'minutes_session='+token;}
 async function request(path,method='GET',body,cookie){const r=await fetch(base+'/api'+path,{method,headers:{Cookie:cookie||'',...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 try{
  for(const id of orgs)await pool.query('INSERT INTO organizations(id,name,demo) VALUES($1,$2,true)',[id,'Capture test '+id]);
  for(const [id,o,roles] of [[admin,org,['ORG_ADMIN']],[member,org,['MEMBER']],[outsider,other,['ORG_ADMIN']]])await pool.query('INSERT INTO users(id,org_id,name,email,roles) VALUES($1,$2,$3,$4,$5)',[id,o,'Capture tester',id+'@example.invalid',roles]);
  await pool.query("INSERT INTO units(id,org_id,name,kind) VALUES($1,$2,'Capture test','team')",[unit,org]);await pool.query('UPDATE users SET unit_ids=$2 WHERE id=$1',[member,[unit]]);
  await pool.query("INSERT INTO templates(id,org_id,name,sections) VALUES($1,$2,'Capture test','[]')",[template,org]);
  const a=await session(admin),b=await session(member),c=await session(outsider);
  const created=await request('/meetings','POST',{title:'Synthetic audio test',joinUrl:'',scheduledAt:new Date().toISOString(),unitId:unit,templateId:template,consent:true},a);assert.equal(created.status,201);const id=created.data.id;
  const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
  function file(){const form=new FormData();form.set('file',new Blob([wav],{type:'audio/wav'}),'synthetic-test.wav');return form;}
  assert.equal((await request(`/meetings/${id}/upload`,'POST',file(),b)).status,403);
  assert.equal((await request(`/meetings/${id}/upload`,'POST',file(),c)).status,404);
  assert.equal((await request(`/meetings/${id}/upload`,'POST',file(),a)).status,200);
  let m=(await request('/meetings/'+id,'GET',null,a)).data;audioPath=m.file_path;assert.equal(m.status,'UPLOADED');
  assert.equal((await request(`/meetings/${id}/upload`,'POST',file(),a)).status,409);
  const range=await fetch(`${base}/api/meetings/${id}/audio`,{headers:{Cookie:a,Range:'bytes=0-43'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,44);assert.match(range.headers.get('content-type'),/audio\/wav/);
  assert.equal((await fetch(`${base}/api/meetings/${id}/audio`,{headers:{Cookie:c}})).status,404);
  const segments=[{id:'s1',speaker:'speaker_0',start:0,end:1,text:'John will send the report.'},{id:'s2',speaker:'speaker_0',start:2,text:'Agreed.'}];
  assert.equal((await request(`/meetings/${id}/transcript`,'PUT',{segments,revision:m.revision},a)).status,200);m=(await request('/meetings/'+id,'GET',null,a)).data;
  const sourceId=m.transcripts[0].id;
  const content={summary:'Report discussed.',attendees:[],items:[{type:'decision',text:'Report agreed.',evidence:'s1',quote:segments[0].text,owner:'',dueDate:'',verified:true}]};
  assert.equal((await request(`/meetings/${id}/minutes`,'PUT',{content,revision:m.minutes[0].revision},a)).status,200);
  const body={revision:m.revision,transcriptId:sourceId,names:[{id:'speaker_0',name:'John'},{id:'manual-test',name:'Mary'}],corrections:[{segmentId:'s2',speakerId:'manual-test'}]};
  assert.equal((await request(`/meetings/${id}/speakers`,'PUT',body,b)).status,403);assert.equal((await request(`/meetings/${id}/speakers`,'PUT',body,c)).status,404);
  assert.equal((await request(`/meetings/${id}/speakers`,'PUT',{...body,transcriptId:randomUUID()},a)).status,409);
  assert.equal((await request(`/meetings/${id}/speakers`,'PUT',{...body,corrections:[{segmentId:'foreign',speakerId:'speaker_0'}]},a)).status,400);
  assert.equal((await request(`/meetings/${id}/speakers`,'PUT',body,a)).status,200);assert.equal((await request(`/meetings/${id}/speakers`,'PUT',body,a)).status,409);
  m=(await request('/meetings/'+id,'GET',null,a)).data;assert.equal(m.transcripts.length,2);assert.equal(m.transcripts[1].id,sourceId);assert.equal(m.transcripts[1].segments[0].speaker,'speaker_0');assert.deepEqual(m.transcripts[0].segments.map(s=>s.speaker),['John','Mary']);assert.equal(m.transcripts[0].segments[1].sourceSpeakerId,'speaker_0');assert.equal(m.transcripts[0].segments[0].start,0);assert.equal(m.transcripts[0].segments[0].text,segments[0].text);assert.equal(m.minutes[0].content.items[0].verified,false);assert.equal(m.minutes[0].transcript_id,m.transcripts[0].id);
  assert.equal((await request(`/meetings/${id}/actions/submit`,'POST',{revision:m.revision},a)).status,422);
  await request(`/meetings/${id}/minutes`,'PUT',{content,revision:m.minutes[0].revision},a);assert.equal((await request(`/meetings/${id}/actions/submit`,'POST',{revision:m.revision},a)).status,200);
  m=(await request('/meetings/'+id,'GET',null,a)).data;assert.equal((await request(`/meetings/${id}/speakers`,'PUT',{...body,revision:m.revision,transcriptId:m.transcripts[0].id},a)).status,409);
  assert.equal((await request(`/meetings/${id}/actions/approve`,'POST',{revision:m.revision},a)).status,200);m=(await request('/meetings/'+id,'GET',null,a)).data;
  assert.equal((await request(`/meetings/${id}/speakers`,'PUT',{...body,revision:m.revision,transcriptId:m.transcripts[0].id},a)).status,409);
  const approved=m.minutes[0],approvedSource=m.transcripts[0];
  const correction={revision:m.revision,transcriptId:approvedSource.id,createRevision:true,names:[{id:'speaker_0',name:'John Chan'}],corrections:[]};
  await pool.query("UPDATE users SET roles=ARRAY['REVIEWER'] WHERE id=$1",[member]);
  assert.equal((await request(`/meetings/${id}/speakers`,'PUT',correction,b)).status,409);
  assert.equal((await request(`/meetings/${id}/speakers`,'PUT',correction,a)).status,200);
  m=(await request('/meetings/'+id,'GET',null,a)).data;
  assert.equal(m.status,'READY_FOR_REVIEW');assert.equal(m.minutes[0].status,'DRAFT');assert.equal(m.minutes[0].content.items[0].verified,false);
  assert.equal(m.minutes[1].id,approved.id);assert.equal(m.minutes[1].status,'APPROVED');assert.deepEqual(m.minutes[1].content,approved.content);assert.equal(m.minutes[1].transcript_id,approvedSource.id);
  assert.equal(m.transcripts[0].segments[0].speaker,'John Chan');assert.equal(m.transcripts[1].segments[0].speaker,'John');
 }finally{
  if(audioPath)await unlink(audioPath).catch(()=>{});
  for(const table of ['audit','rate_cards','integrations','oauth_states'])await pool.query(`DELETE FROM ${table} WHERE org_id=ANY($1::uuid[])`,[orgs]);
  await pool.query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id=ANY($1::uuid[]))',[orgs]);
  for(const table of ['jobs','usage','minutes','transcripts'])await pool.query(`DELETE FROM ${table} WHERE meeting_id IN (SELECT id FROM meetings WHERE org_id=ANY($1::uuid[]))`,[orgs]);
  for(const table of ['meetings','templates','users','units','organizations'])await pool.query(`DELETE FROM ${table} WHERE ${table==='organizations'?'id':'org_id'}=ANY($1::uuid[])`,[orgs]);await pool.end();
 }
});
