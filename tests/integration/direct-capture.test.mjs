import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {query,tx,pool} from '../../services/api/db.mjs';import {encrypt} from '../../services/api/providers.mjs';
import {queueCapture,queueCaptureStop,runCaptureJob,processCaptureEvent} from '../../services/api/capture.mjs';
import {applyDirectStatus,validateDirectSession} from '../../services/api/direct-capture.mjs';
const base=process.env.TEST_URL||'http://127.0.0.1:5000';
test('capture methods preserve credentials, prevent fallback, scope configuration and run direct lifecycle to transcription',async()=>{
 const org=randomUUID(),other=randomUUID(),user=randomUUID(),outsider=randomUUID(),unit=randomUUID(),template=randomUUID(),originalFetch=globalThis.fetch;let file;
 async function session(id){const token=randomBytes(32).toString('hex');await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),id]);return 'minutes_session='+token;}
 async function req(url,method='GET',body,cookie){const r=await originalFetch(base+'/api'+url,{method,headers:{Cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 async function meeting(){const id=randomUUID();await query("INSERT INTO meetings(id,org_id,unit_id,owner_id,title,platform,join_url,scheduled_at,template_id,consent,status) VALUES($1,$2,$3,$4,'Direct capture TEST','Zoom','https://zoom.us/j/123456789',now()+interval '1 hour',$5,true,'SETUP_REQUIRED')",[id,org,unit,user,template]);return (await query('SELECT * FROM meetings WHERE id=$1',[id])).rows[0];}
 async function queue(m){await tx(async db=>{assert.equal(await queueCapture(db,m),true);await db.query("UPDATE jobs SET run_at='2100-01-01' WHERE meeting_id=$1",[m.id]);await db.query("UPDATE capture_sessions SET polled_at='2100-01-01' WHERE meeting_id=$1",[m.id]);});}
 try{
  for(const id of [org,other])await query('INSERT INTO organizations(id,name) VALUES($1,$2)',[id,'Direct option TEST '+id]);
  for(const [id,o] of [[user,org],[outsider,other]])await query("INSERT INTO users(id,org_id,name,email,roles) VALUES($1,$2,'Direct test',$3,ARRAY['ORG_ADMIN'])",[id,o,id+'@example.invalid']);
  await query("INSERT INTO units(id,org_id,name,kind) VALUES($1,$2,'Test','team')",[unit,org]);await query("INSERT INTO templates(id,org_id,name,sections) VALUES($1,$2,'Test','[]')",[template,org]);
  const a=await session(user),b=await session(outsider);
  assert.equal((await req('/admin/capture/Zoom/method','GET',null,a)).data.method,'recall');
  assert.equal((await req('/admin/capture/Zoom/method','PUT',{method:'unrecognised'},a)).status,400);
  const recallSecret=encrypt('synthetic-recall-key');await query("INSERT INTO capture_connections(org_id,platform,config,secret,webhook_secret,enabled,checked_at,webhook_checked_at) VALUES($1,'Zoom','{}',$2,$2,true,now(),now())",[org,recallSecret]);
  assert.equal((await req('/admin/capture/Zoom/method','PUT',{method:'direct'},a)).status,200);
  assert.equal((await req('/admin/capture/Zoom/method','GET',null,b)).data.method,'recall');
  assert.equal((await req('/admin/capture/Teams/method','GET',null,a)).data.method,'recall');
  const m=await meeting();assert.equal(await tx(db=>queueCapture(db,m)),false); // Never fall back to configured Recall.
  const config={workerUrl:'http://host.docker.internal:8020',clientId:'synthetic-zoom-client',accountId:'synthetic-account',botName:'TEST RTMS',notice:'This is a consented synthetic test recording.',secret:'synthetic-worker-key',enabled:true,acknowledged:true};
  assert.equal((await req('/admin/capture/Zoom/direct','PUT',config,a)).status,200);
  let view=(await req('/admin/capture/Zoom/direct','GET',null,a)).data;assert.equal(view.has_secret,true);assert.equal(view.secret,undefined);assert.equal(view.config.secret,undefined);assert.equal(view.checked_at,null);
  assert.equal((await req('/admin/capture/Zoom/direct','GET',null,b)).data.has_secret,undefined);
  assert.equal(await tx(db=>queueCapture(db,m)),false);
  const teamsConfig={...config,workerUrl:'http://host.docker.internal:8010',clientId:randomUUID(),tenantId:randomUUID()};assert.equal((await req('/admin/capture/Teams/direct','PUT',teamsConfig,a)).status,200);
  await query('UPDATE direct_capture_connections SET checked_at=now() WHERE org_id=$1',[org]);await req('/admin/capture/Zoom/direct','PUT',{...config,secret:''},a);view=(await req('/admin/capture/Zoom/direct','GET',null,a)).data;assert.ok(view.checked_at); // Blank secret preserves the key and verification.
  for(const provider of ['ElevenLabs','Minutes AI'])await query('INSERT INTO integrations(org_id,provider,secret) VALUES($1,$2,$3)',[org,provider,encrypt('synthetic')]);
  await queue(m);let s=(await query('SELECT * FROM capture_sessions WHERE meeting_id=$1',[m.id])).rows[0];assert.equal(s.config.captureMethod,'direct');
  assert.equal((await req('/admin/capture/Zoom/method','PUT',{method:'recall'},a)).status,409);
  assert.equal((await req('/admin/capture/Zoom/direct','PUT',{...config,secret:'changed'},a)).status,409);
  let count=0;const stamp=Date.now();const status=(state,extra={},at=stamp)=>({id:m.id,platform:'Zoom',state,updatedAt:new Date(at).toISOString(),...extra});
  globalThis.fetch=async(url,options)=>{count++;assert.equal(String(url),`http://host.docker.internal:8020/v1/sessions/${m.id}`);assert.equal(options.method,'PUT');assert.equal(options.headers.Authorization,'Bearer synthetic-worker-key');assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).consent,true);return Response.json(status('WAITING_FOR_HOST'));};
  await runCaptureJob({type:'CAPTURE_CREATE'},m,process.env.DATA_DIR);await runCaptureJob({type:'CAPTURE_CREATE'},m,process.env.DATA_DIR);assert.equal(count,1);
  await query("UPDATE jobs SET status='COMPLETED' WHERE meeting_id=$1",[m.id]);s=(await query('SELECT * FROM capture_sessions WHERE meeting_id=$1',[m.id])).rows[0];
  assert.equal((await query('SELECT status FROM meetings WHERE id=$1',[m.id])).rows[0].status,'WAITING_FOR_HOST');
  await tx(db=>processCaptureEvent(db,{org_id:org,platform:'Zoom',payload:{event:'bot.fatal',data:{bot:{id:m.id},data:{updated_at:new Date(stamp+500).toISOString()}}}}));assert.equal((await query('SELECT status FROM meetings WHERE id=$1',[m.id])).rows[0].status,'WAITING_FOR_HOST');
  await tx(db=>applyDirectStatus(db,s,validateDirectSession(status('RECORDING',{},stamp+1000),s)));await tx(db=>applyDirectStatus(db,s,validateDirectSession(status('WAITING_FOR_HOST'),s)));assert.equal((await query('SELECT status FROM meetings WHERE id=$1',[m.id])).rows[0].status,'CAPTURING');
  await tx(async db=>{await queueCaptureStop(db,m);await db.query("UPDATE jobs SET run_at='2100-01-01' WHERE meeting_id=$1",[m.id]);});
  globalThis.fetch=async(url,options)=>{assert.ok(String(url).endsWith('/stop'));assert.equal(options.method,'POST');return Response.json(status('PROCESSING',{},stamp+2000));};await runCaptureJob({type:'CAPTURE_STOP'},m,process.env.DATA_DIR);
  const audio=Buffer.from('RIFF-synthetic-wave-data'),done=status('COMPLETED',{audio:{mime:'audio/wav',bytes:audio.length}},stamp+3000);
  await tx(async db=>{await applyDirectStatus(db,s,validateDirectSession(done,s));await db.query("UPDATE jobs SET run_at='2100-01-01' WHERE meeting_id=$1",[m.id]);});
  globalThis.fetch=async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer synthetic-worker-key');assert.equal(options.redirect,'error');return String(url).endsWith('/audio')?new Response(audio):Response.json(done);};await runCaptureJob({type:'CAPTURE_IMPORT'},m,process.env.DATA_DIR,{transcribeAt:new Date('2100-01-01')});
  const imported=(await query('SELECT * FROM meetings WHERE id=$1',[m.id])).rows[0];file=imported.file_path;assert.equal(imported.status,'TRANSCRIBING_FINAL');assert.equal(imported.mime_type,'audio/wav');await runCaptureJob({type:'CAPTURE_IMPORT'},m,process.env.DATA_DIR);
  const detail=(await req('/meetings/'+m.id,'GET',null,a)).data;assert.equal(detail.capture.method,'direct');assert.equal(detail.capture.secret,undefined);assert.equal((await req('/meetings/'+m.id,'GET',null,b)).status,404);
  assert.equal((await req('/admin/capture/Zoom/method','PUT',{method:'recall'},a)).status,200);
  assert.equal((await query("SELECT secret FROM capture_connections WHERE org_id=$1 AND platform='Zoom'",[org])).rows[0].secret,recallSecret);
  assert.equal((await req('/meetings/'+m.id,'GET',null,a)).data.capture.method,'direct'); // Completed sessions keep their original method.
  assert.equal((await req('/admin/capture/Zoom/direct','PUT',{...config,clientId:'different-client',secret:''},a)).status,200);assert.equal((await req('/admin/capture/Zoom/direct','GET',null,a)).data.checked_at,null);
 }finally{
  globalThis.fetch=originalFetch;if(file){const {unlink}=await import('node:fs/promises');await unlink(file).catch(()=>{});}
  for(const table of ['capture_webhooks','capture_sessions','capture_connections','direct_capture_connections','capture_preferences','audit','integrations'])await query(`DELETE FROM ${table} WHERE org_id=ANY($1::uuid[])`,[[org,other]]);
  await query('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id=ANY($1::uuid[]))',[[org,other]]);
  for(const table of ['jobs','usage','minutes','transcripts'])await query(`DELETE FROM ${table} WHERE meeting_id IN (SELECT id FROM meetings WHERE org_id=ANY($1::uuid[]))`,[[org,other]]);
  for(const table of ['meetings','templates','users','units','organizations'])await query(`DELETE FROM ${table} WHERE ${table==='organizations'?'id':'org_id'}=ANY($1::uuid[])`,[[org,other]]);await pool.end();
 }
});
