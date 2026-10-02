import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {query,tx,audit,pool} from './db.mjs';
import {encrypt,decrypt} from './providers.mjs';
import {captureError as fail,capturePlatforms} from './capture-domain.mjs';

export const DIRECT_PROTOCOL='ai-minutes-capture/v1';
export const DIRECT_STATES={QUEUED:'SCHEDULED',JOINING:'JOINING_CALL',WAITING_FOR_ADMISSION:'WAITING_FOR_ADMISSION',WAITING_FOR_HOST:'WAITING_FOR_HOST',CONNECTED:'IN_CALL_NOT_RECORDING',RECORDING:'CAPTURING',PROCESSING:'PROCESSING_RECORDING',COMPLETED:'PROCESSING_RECORDING',STOPPED:'CANCELLED',FAILED:'FAILED'};
const defaults='http://host.docker.internal:8010,http://host.docker.internal:8020,http://localhost:8010,http://localhost:8020,http://teams-media-worker:8010,http://zoom-rtms-worker:8020';
export function workerOrigin(value) {
  let u;try{u=new URL(value);}catch{throw fail(400,'Enter the worker base URL.');}
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw fail(400,'Worker URL must be an HTTP(S) origin without credentials or a path.');
  const allowed=(process.env.CAPTURE_WORKER_ALLOWED_ORIGINS??defaults).split(',').map(s=>s.trim()).filter(Boolean);
  if(!allowed.includes(u.origin))throw fail(400,'Add this exact worker origin to CAPTURE_WORKER_ALLOWED_ORIGINS in the Docker .env file, recreate the app, then save again.');
  return u.origin;
}
function resolvedOrigin(value){const u=new URL(workerOrigin(value));if(process.env.LLM_LOOPBACK_HOST&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))u.hostname=process.env.LLM_LOOPBACK_HOST;return u.origin;}
export async function directRequest(c,route,method='GET',body,{raw=false}={}) {
  let r;try{r=await fetch(resolvedOrigin(c.config.workerUrl)+route,{method,headers:{Authorization:`Bearer ${decrypt(c.secret)}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(raw?180000:20000)});}catch{throw fail(502,'Direct worker is unreachable. Check its address, TLS certificate, API key and deployment.');}
  if(!r.ok)throw fail(502,`Direct worker returned HTTP ${r.status}. Check the worker logs and configuration.`);
  if(raw)return r;
  if(r.status===204)return {};
  try{return await r.json();}catch{throw fail(502,'Direct worker returned an invalid response.');}
}
export function validateWorkerHealth(body,platform,config) {
  if(body?.protocol!==DIRECT_PROTOCOL||body.platform!==platform||body.ready!==true)throw fail(409,'Worker is not ready or does not implement the AI Minutes capture protocol. Deploy the platform-specific media adapter first.');
  if(body.clientId!==config.clientId||platform==='Teams'&&body.tenantId!==config.tenantId||platform==='Zoom'&&body.accountId!==config.accountId)throw fail(409,'Worker identity does not match the configured application/account.');
  const required=['audio','schedule','stop','idempotentSessions',platform==='Teams'?'recordingStatus':'rtms'];
  if(required.some(cap=>body.capabilities?.[cap]!==true))throw fail(409,'Worker is missing required capture capabilities. Follow the worker contract in the setup guide.');
}
export async function selectedCaptureMethod(db,org,platform){return (await db.query('SELECT method FROM capture_preferences WHERE org_id=$1 AND platform=$2',[org,platform])).rows[0]?.method||'recall';}
export async function directReady(db,org,platform){return (await db.query('SELECT * FROM direct_capture_connections WHERE org_id=$1 AND platform=$2 AND enabled AND checked_at IS NOT NULL AND secret IS NOT NULL',[org,platform])).rows[0];}
async function lockSelection(db,org,platform){await db.query("INSERT INTO capture_preferences(org_id,platform,method) VALUES($1,$2,'recall') ON CONFLICT DO NOTHING",[org,platform]);await db.query('SELECT method FROM capture_preferences WHERE org_id=$1 AND platform=$2 FOR UPDATE',[org,platform]);}
async function assertNoActive(db,org,platform){if((await db.query("SELECT 1 FROM capture_sessions WHERE org_id=$1 AND platform=$2 AND state NOT IN ('CANCELLED','ENDED','REJECTED','fatal') AND imported_at IS NULL",[org,platform])).rowCount)throw fail(409,'Finish or stop active capture sessions before switching methods or changing the worker configuration.');}
export function directCaptureRoutes(app,{admin,wrap}) {
  app.get('/api/admin/capture/:platform/method',admin,wrap(async(req,res)=>{const platform=z.enum(capturePlatforms).parse(req.params.platform);res.json({method:await selectedCaptureMethod(pool,req.user.org_id,platform),sample:req.user.demo});}));
  app.put('/api/admin/capture/:platform/method',admin,wrap(async(req,res)=>{
    if(req.user.demo)throw fail(403,'Change capture methods in your company workspace.');
    const platform=z.enum(capturePlatforms).parse(req.params.platform),method=z.enum(['recall','direct']).parse(req.body.method);
    await tx(async db=>{await lockSelection(db,req.user.org_id,platform);const current=await selectedCaptureMethod(db,req.user.org_id,platform);if(current!==method){await assertNoActive(db,req.user.org_id,platform);await db.query('UPDATE capture_preferences SET method=$3 WHERE org_id=$1 AND platform=$2',[req.user.org_id,platform,method]);await audit(db,req.user,'capture.method_selected',null,{platform,method});}});res.json({ok:true});
  }));
  app.get('/api/admin/capture/:platform/direct',admin,wrap(async(req,res)=>{
    const platform=z.enum(capturePlatforms).parse(req.params.platform);
    const row=(await query('SELECT config,enabled,checked_at,secret IS NOT NULL AS has_secret FROM direct_capture_connections WHERE org_id=$1 AND platform=$2',[req.user.org_id,platform])).rows[0]||{config:{},enabled:false};
    res.json({...row,sample:req.user.demo,protocol:DIRECT_PROTOCOL});
  }));
  app.put('/api/admin/capture/:platform/direct',admin,wrap(async(req,res)=>{
    if(req.user.demo)throw fail(403,'Save worker credentials in your company workspace.');
    const platform=z.enum(capturePlatforms).parse(req.params.platform);
    const v=z.object({workerUrl:z.string().transform(workerOrigin),clientId:z.string().trim().min(1).max(150),tenantId:z.string().trim().max(100).optional(),accountId:z.string().trim().max(100).optional(),botName:z.string().trim().min(2).max(100),notice:z.string().trim().min(20).max(500),secret:z.string().trim().max(1000).optional(),enabled:z.boolean(),acknowledged:z.literal(true)}).parse(req.body);
    if(platform==='Teams'){z.uuid().parse(v.tenantId);z.uuid().parse(v.clientId);}else if(!v.accountId)throw fail(400,'Enter the Zoom account ID that owns the RTMS application.');
    const config={workerUrl:v.workerUrl,clientId:v.clientId,tenantId:platform==='Teams'?v.tenantId:undefined,accountId:platform==='Zoom'?v.accountId:undefined,botName:v.botName,notice:v.notice,captureMethod:'direct'};
    await tx(async db=>{await lockSelection(db,req.user.org_id,platform);const old=(await db.query('SELECT * FROM direct_capture_connections WHERE org_id=$1 AND platform=$2 FOR UPDATE',[req.user.org_id,platform])).rows[0];
      const changed=!old||!!v.secret||['workerUrl','clientId','tenantId','accountId'].some(k=>old.config[k]!==config[k]);
      if(changed)await assertNoActive(db,req.user.org_id,platform);
      const secret=v.secret?encrypt(v.secret):old?.secret;if(!secret)throw fail(400,'Enter the worker API key. Provider credentials belong on the worker.');
      await db.query('INSERT INTO direct_capture_connections(org_id,platform,config,secret,enabled,checked_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(org_id,platform) DO UPDATE SET config=EXCLUDED.config,secret=EXCLUDED.secret,enabled=EXCLUDED.enabled,checked_at=EXCLUDED.checked_at,updated_at=now()',[req.user.org_id,platform,config,secret,v.enabled,changed?null:old?.checked_at]);await audit(db,req.user,'capture.direct_configured',null,{platform,enabled:v.enabled});
    });res.json({ok:true});
  }));
  app.post('/api/admin/capture/:platform/direct/test',admin,wrap(async(req,res)=>{
    if(req.user.demo)throw fail(403,'Worker tests are unavailable in the sample workspace.');
    const platform=z.enum(capturePlatforms).parse(req.params.platform),c=(await query('SELECT * FROM direct_capture_connections WHERE org_id=$1 AND platform=$2',[req.user.org_id,platform])).rows[0];if(!c?.secret)throw fail(409,'Save the direct configuration first.');
    await query('UPDATE direct_capture_connections SET checked_at=NULL WHERE org_id=$1 AND platform=$2 AND secret=$3 AND config=$4',[req.user.org_id,platform,c.secret,c.config]);
    validateWorkerHealth(await directRequest(c,'/v1/health'),platform,c.config);
    await query('UPDATE direct_capture_connections SET checked_at=now() WHERE org_id=$1 AND platform=$2 AND secret=$3 AND config=$4',[req.user.org_id,platform,c.secret,c.config]);
    res.json({ok:true,message:'Worker identity and capabilities verified. No meeting was joined. A consented live capture test is still required.'});
  }));
}
export async function captureSummary(org){
  const result=[];for(const platform of capturePlatforms){const method=await selectedCaptureMethod(pool,org,platform),table=method==='direct'?'direct_capture_connections':'capture_connections';const c=(await query(`SELECT * FROM ${table} WHERE org_id=$1 AND platform=$2`,[org,platform])).rows[0];result.push({provider:platform,config:{captureMethod:method},status:c?.enabled&&c?.checked_at&&(method==='direct'||c?.webhook_checked_at)?'READY':c?.secret?'SETUP_INCOMPLETE':'NOT_CONFIGURED',has_secret:!!c?.secret,checked_at:c?.checked_at||null});}return result;
}
export async function lockCaptureMethod(db,org,platform){await lockSelection(db,org,platform);return selectedCaptureMethod(db,org,platform);}

const stateSchema=z.object({id:z.uuid(),platform:z.enum(capturePlatforms),state:z.enum(Object.keys(DIRECT_STATES)),updatedAt:z.iso.datetime(),message:z.string().max(250).optional(),audio:z.object({mime:z.enum(['audio/wav','audio/mpeg']),bytes:z.number().int().positive().max(250*1024*1024)}).optional()});
export function validateDirectSession(data,s){const parsed=stateSchema.parse(data);if(parsed.id!==s.meeting_id||parsed.platform!==s.platform)throw fail(502,'Worker returned a session for another meeting or platform.');if(parsed.state==='COMPLETED'&&!parsed.audio)throw fail(502,'Completed session has no recording metadata.');return parsed;}
export async function applyDirectStatus(db,s,data){
  const m=(await db.query('SELECT * FROM meetings WHERE id=$1 FOR UPDATE',[s.meeting_id])).rows[0];const current=(await db.query('SELECT * FROM capture_sessions WHERE meeting_id=$1 FOR UPDATE',[s.meeting_id])).rows[0];
  if(!current||current.imported_at||['CANCELLED','ENDED'].includes(current.state)||['READY_FOR_REVIEW','IN_REVIEW','APPROVED','REJECTED','TRANSCRIBING_FINAL','GENERATING_MINUTES'].includes(m.status))return;
  if(current.last_event_at&&new Date(data.updatedAt)<=new Date(current.last_event_at))return;
  if(data.state==='COMPLETED'){
    await db.query("UPDATE capture_sessions SET state='ENDED',recording_id=meeting_id,last_event_at=$2 WHERE meeting_id=$1",[m.id,data.updatedAt]);await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_IMPORT') ON CONFLICT DO NOTHING",[randomUUID(),m.id]);
  }else await db.query('UPDATE capture_sessions SET state=$2,last_event_at=$3 WHERE meeting_id=$1',[m.id,data.state==='STOPPED'?'CANCELLED':data.state,data.updatedAt]);
  if(current.stop_requested&&!['COMPLETED','STOPPED','FAILED'].includes(data.state))return;
  await db.query('UPDATE meetings SET status=$2,error=$3,revision=revision+1 WHERE id=$1',[m.id,DIRECT_STATES[data.state],data.state==='FAILED'?'Direct capture failed. Check the worker logs; use recording upload if a partial recording was recovered.':null]);
}
export async function runDirectJob(job,m,s,dataDir,{transcribeAt=new Date()}={}) {
  const route=`/v1/sessions/${m.id}`;
  if(job.type==='CAPTURE_CREATE'){
    if(s.stop_requested||s.bot_id)return;
    const claimed=await query("UPDATE capture_sessions SET state='DISPATCHING' WHERE meeting_id=$1 AND state IN ('PENDING','UNKNOWN') AND NOT stop_requested RETURNING meeting_id",[m.id]);if(!claimed.rowCount)return;
    try{const result=await directRequest(s,route,'PUT',{id:m.id,platform:m.platform,meetingUrl:m.join_url,scheduledAt:new Date(m.scheduled_at).toISOString(),durationMinutes:m.duration_minutes,consent:true,displayName:s.config.botName,notice:s.config.notice});validateDirectSession(result,s);
      await query("UPDATE capture_sessions SET bot_id=meeting_id,state='CREATED' WHERE meeting_id=$1",[m.id]);await tx(db=>applyDirectStatus(db,s,result));
      if((await query('SELECT stop_requested FROM capture_sessions WHERE meeting_id=$1',[m.id])).rows[0]?.stop_requested)await query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_STOP') ON CONFLICT DO NOTHING",[randomUUID(),m.id]);
    }catch(e){await query("UPDATE capture_sessions SET state='UNKNOWN' WHERE meeting_id=$1 AND bot_id IS NULL",[m.id]);throw e;}
  }else if(job.type==='CAPTURE_STOP'){
    if(s.imported_at||['CANCELLED','ENDED'].includes(s.state))return;
    // Stable session IDs make stop safe even when the create response was lost.
    const result=validateDirectSession(await directRequest(s,route+'/stop','POST'),s);await tx(db=>applyDirectStatus(db,s,result));
  }else if(job.type==='CAPTURE_IMPORT'){
    if(s.imported_at)return;
    const result=validateDirectSession(await directRequest(s,route),s);if(result.state!=='COMPLETED')throw fail(409,'The worker recording is not complete.');
    const mime=result.audio.mime,extension=mime==='audio/wav'?'wav':'mp3',filename=path.join(dataDir,`direct-${randomUUID()}.${extension}`);
    const response=await directRequest(s,route+'/audio','GET',null,{raw:true});let bytes=0;
    try{await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,_enc,cb){bytes+=chunk.length;cb(bytes>250*1024*1024?fail(413,'Direct recording exceeds 250 MB.'):null,chunk);}}),createWriteStream(filename,{flags:'wx'}));if(bytes!==result.audio.bytes)throw fail(502,'Recording size did not match the worker metadata. Retry import.');
      await tx(async db=>{const current=(await db.query('SELECT * FROM meetings WHERE id=$1 FOR UPDATE',[m.id])).rows[0];const locked=(await db.query('SELECT * FROM capture_sessions WHERE meeting_id=$1 FOR UPDATE',[m.id])).rows[0];if(locked.imported_at||current.file_path||(await db.query('SELECT 1 FROM transcripts WHERE meeting_id=$1',[m.id])).rowCount)throw fail(409,'A recording already exists; direct import did not overwrite it.');await db.query("UPDATE meetings SET file_path=$2,file_name=$3,mime_type=$4,status='TRANSCRIBING_FINAL',error=NULL,revision=revision+1 WHERE id=$1",[m.id,filename,`${m.platform}-direct.${extension}`,mime]);await db.query("UPDATE capture_sessions SET imported_at=now(),state='ENDED' WHERE meeting_id=$1",[m.id]);await db.query("INSERT INTO jobs(id,meeting_id,type,run_at) VALUES($1,$2,'TRANSCRIBE',$3)",[randomUUID(),m.id,transcribeAt]);await audit(db,{org_id:m.org_id,id:m.owner_id},'capture.direct_imported',m.id);});
    }catch(e){await unlink(filename).catch(()=>{});throw e;}
  }
}
let busy=false;
export async function pollDirectCaptures(){
  if(busy)return;busy=true;
  try{const rows=(await query("SELECT * FROM capture_sessions WHERE config->>'captureMethod'='direct' AND bot_id IS NOT NULL AND state NOT IN ('CANCELLED','ENDED','FAILED') AND imported_at IS NULL AND (polled_at IS NULL OR polled_at<now()-interval '10 seconds') ORDER BY polled_at NULLS FIRST LIMIT 10")).rows;
    for(const s of rows){try{const data=validateDirectSession(await directRequest(s,`/v1/sessions/${s.meeting_id}`),s);await tx(db=>applyDirectStatus(db,s,data));}catch{await query("UPDATE meetings SET error='Direct worker status is unavailable. Recording status is unconfirmed; check the worker or retry stop.' WHERE id=$1 AND status IN ('SCHEDULED','JOINING_CALL','WAITING_FOR_HOST','WAITING_FOR_ADMISSION','IN_CALL_NOT_RECORDING','CAPTURING','STOPPING_CAPTURE','PROCESSING_RECORDING')",[s.meeting_id]);}finally{await query('UPDATE capture_sessions SET polled_at=now() WHERE meeting_id=$1',[s.meeting_id]);}}
  }finally{busy=false;}
}
