import express from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {query,tx,audit,pool} from './db.mjs';
import {encrypt,decrypt,recordUsage} from './providers.mjs';
import {captureRegions,capturePlatforms,captureEvents,captureError as fail,publicWebhookBase,verifyCaptureWebhook,botRequest,eventState,recallAsyncTranscriptRequest,recallTranscriptSegments} from './capture-domain.mjs';
import {saveTranscription} from './minutes-workflow.mjs';
import {directReady,lockCaptureMethod,runDirectJob} from './direct-capture.mjs';

export async function recallRequest(connection,route,method='GET',body) {
  if(!captureRegions.includes(connection.config.region))throw fail(400,'Choose the Recall region that issued your key.');
  let r;
  try {r=await fetch(`https://${connection.config.region}.recall.ai/api/v1/${route}`,{method,headers:{Authorization:decrypt(connection.secret),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(30000)});}
  catch {throw fail(502,method==='POST'?'Capture service response is uncertain. Check the Recall dashboard before retrying; a bot may already exist.':'Capture service could not be reached. Try again later.');}
  if(!r.ok){const e=fail(502,`Recall returned HTTP ${r.status}. ${r.status===401?'Check the API key and selected region.':r.status===507?'No immediate bot capacity. Schedule in advance or retry later.':r.status===429?'Request limit reached. Wait before retrying.':'Check the Recall dashboard for account permissions and service status.'}`);e.retryAfter=[429,503,507].includes(r.status)?Math.max(r.status===507?30:10,Number(r.headers.get('retry-after'))||10):null;throw e;}
  if(r.status===204)return {};
  const text=await r.text();return text?JSON.parse(text):{};
}
export async function captureReady(db,org,platform) {
  return (await db.query('SELECT * FROM capture_connections WHERE org_id=$1 AND platform=$2 AND enabled AND checked_at IS NOT NULL AND webhook_checked_at IS NOT NULL AND secret IS NOT NULL AND webhook_secret IS NOT NULL',[org,platform])).rows[0];
}
export async function queueCapture(db,m) {
  if(m.sample||!m.consent||!capturePlatforms.includes(m.platform))return false;
  const method=await lockCaptureMethod(db,m.org_id,m.platform);
  const c=await (method==='direct'?directReady:captureReady)(db,m.org_id,m.platform);if(!c)return false;
  const existing=await db.query('SELECT state FROM capture_sessions WHERE meeting_id=$1',[m.id]);
  if(existing.rowCount&&existing.rows[0].state!=='REJECTED')throw fail(409,'A capture session already exists. Check its status instead of sending another bot.');
  // A named Recall bot can return participant-attributed transcript data.
  // Direct receivers supply audio only, so they remain on ElevenLabs.
  const transcriptionProvider=method==='recall'?'recall':'elevenlabs';
  for(const provider of [transcriptionProvider==='elevenlabs'?'ElevenLabs':null,'Minutes AI'].filter(Boolean))if(!(await db.query('SELECT 1 FROM integrations WHERE org_id=$1 AND provider=$2 AND secret IS NOT NULL',[m.org_id,provider])).rowCount)throw fail(409,`Configure ${provider} before sending the minutes taker.`);
  await db.query("INSERT INTO capture_sessions(meeting_id,org_id,platform,config,secret) VALUES($1,$2,$3,$4,$5) ON CONFLICT(meeting_id) DO UPDATE SET config=EXCLUDED.config,secret=EXCLUDED.secret,state='PENDING',stop_requested=false",[m.id,m.org_id,m.platform,{...c.config,captureMethod:method,transcriptionProvider},c.secret]);
  await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_CREATE')",[randomUUID(),m.id]);
  await db.query("UPDATE meetings SET status='SCHEDULED',error=NULL,revision=revision+1 WHERE id=$1",[m.id]);
  return true;
}
export async function queueCaptureStop(db,m) {
  const s=(await db.query('SELECT * FROM capture_sessions WHERE meeting_id=$1 FOR UPDATE',[m.id])).rows[0];
  if(!s)return false;
  if(s.imported_at||['CANCELLED','ENDED'].includes(s.state))throw fail(409,'This capture has already ended.');
  await db.query('UPDATE capture_sessions SET stop_requested=true WHERE meeting_id=$1',[m.id]);
  if(['PENDING','REJECTED'].includes(s.state)&&!s.bot_id){
    await db.query("UPDATE jobs SET status='CANCELLED' WHERE meeting_id=$1 AND type='CAPTURE_CREATE' AND status='PENDING'",[m.id]);
    await db.query("UPDATE capture_sessions SET state='CANCELLED' WHERE meeting_id=$1",[m.id]);
    await db.query("UPDATE meetings SET status='CANCELLED',revision=revision+1,error=NULL WHERE id=$1",[m.id]);
  }else{
    if(s.bot_id||s.config.captureMethod==='direct')await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_STOP') ON CONFLICT DO NOTHING",[randomUUID(),m.id]);
    await db.query("UPDATE meetings SET status='STOPPING_CAPTURE',revision=revision+1,error=$2 WHERE id=$1",[m.id,s.bot_id||s.config.captureMethod==='direct'?null:'Waiting for the bot ID. If dispatch was interrupted, recover its ID from the Recall dashboard to stop it.']);
  }
  return true;
}
export function captureRoutes(app,{admin,wrap,meetingFor,requireRole}) {
  app.get('/api/admin/capture/:platform',admin,wrap(async(req,res)=>{
    const platform=z.enum(capturePlatforms).parse(req.params.platform);
    const c=(await query('SELECT config,enabled,checked_at,webhook_checked_at,secret IS NOT NULL AS has_secret,webhook_secret IS NOT NULL AS has_webhook_secret FROM capture_connections WHERE org_id=$1 AND platform=$2',[req.user.org_id,platform])).rows[0]||{config:{},enabled:false};
    res.json({...c,webhookPath:`/api/capture/recall/${req.user.org_id}/${platform.toLowerCase()}`,sample:req.user.demo});
  }));
  app.put('/api/admin/capture/:platform',admin,wrap(async(req,res)=>{
    if(req.user.demo)throw fail(403,'Configure capture in your company workspace. Sample meetings never call external services.');
    const platform=z.enum(capturePlatforms).parse(req.params.platform);
  const v=z.object({region:z.enum(captureRegions),publicBaseUrl:z.string().transform(publicWebhookBase),botName:z.string().trim().min(2).max(100),notice:z.string().trim().min(20).max(500),transcriptionProvider:z.enum(['elevenlabs','recall']).optional(),secret:z.string().trim().max(500).optional(),webhookSecret:z.string().trim().max(500).optional(),enabled:z.boolean(),acknowledged:z.literal(true)}).parse(req.body);
    if(v.webhookSecret&&!/^whsec_[A-Za-z0-9+/=]+$/.test(v.webhookSecret))throw fail(400,'Use the Recall verification secret beginning with whsec_.');
    await tx(async db=>{
      const previous=(await db.query('SELECT * FROM capture_connections WHERE org_id=$1 AND platform=$2 FOR UPDATE',[req.user.org_id,platform])).rows[0];
      // Keep accepting the former field for existing browser sessions, but do
      // not let it override the automatic remote-meeting preference.
      const config={region:v.region,publicBaseUrl:v.publicBaseUrl,botName:v.botName,notice:v.notice,transcriptionProvider:'recall'};
      const changed=!previous||previous.config.region!==v.region||previous.config.publicBaseUrl!==v.publicBaseUrl||!!v.secret||!!v.webhookSecret;
      if(changed&&(await db.query("SELECT 1 FROM capture_sessions WHERE org_id=$1 AND platform=$2 AND state NOT IN ('CANCELLED','ENDED','REJECTED','fatal') AND imported_at IS NULL",[req.user.org_id,platform])).rowCount)throw fail(409,'Finish or stop current capture sessions before changing credentials, region or callback URL.');
      const secret=v.secret?encrypt(v.secret):previous?.secret,wh=v.webhookSecret?encrypt(v.webhookSecret):previous?.webhook_secret;
      if(!secret||!wh)throw fail(400,'Both the Recall API key and webhook verification secret are required.');
      await db.query('INSERT INTO capture_connections(org_id,platform,config,secret,webhook_secret,enabled,checked_at,webhook_checked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(org_id,platform) DO UPDATE SET config=EXCLUDED.config,secret=EXCLUDED.secret,webhook_secret=EXCLUDED.webhook_secret,enabled=EXCLUDED.enabled,checked_at=EXCLUDED.checked_at,webhook_checked_at=EXCLUDED.webhook_checked_at,updated_at=now()',[req.user.org_id,platform,config,secret,wh,v.enabled,changed?null:previous?.checked_at,changed?null:previous?.webhook_checked_at]);
      await audit(db,req.user,'capture.configured',null,{platform,region:v.region,enabled:v.enabled});
    });res.json({ok:true});
  }));
  app.post('/api/admin/capture/:platform/copy-from/:source',admin,wrap(async(req,res)=>{
    if(req.user.demo)throw fail(403,'Copy capture settings in your company workspace.');
    const platform=z.enum(capturePlatforms).parse(req.params.platform),sourcePlatform=z.enum(capturePlatforms).parse(req.params.source);
    if(platform===sourcePlatform)throw fail(400,'Choose the other platform as the Recall configuration source.');
    await tx(async db=>{
      const {rows}=await db.query('SELECT * FROM capture_connections WHERE org_id=$1 AND platform=ANY($2::text[]) ORDER BY platform FOR UPDATE',[req.user.org_id,[platform,sourcePlatform]]);
      const source=rows.find(row=>row.platform===sourcePlatform);
      if(!source?.secret||!source.webhook_secret)throw fail(409,`Save ${sourcePlatform} Recall.ai credentials before copying them.`);
      if((await db.query("SELECT 1 FROM capture_sessions WHERE org_id=$1 AND platform=$2 AND state NOT IN ('CANCELLED','ENDED','REJECTED','fatal') AND imported_at IS NULL",[req.user.org_id,platform])).rowCount)throw fail(409,'Finish or stop active capture sessions before copying settings.');
      await db.query('INSERT INTO capture_connections(org_id,platform,config,secret,webhook_secret,enabled,checked_at,webhook_checked_at) VALUES($1,$2,$3,$4,$5,$6,NULL,NULL) ON CONFLICT(org_id,platform) DO UPDATE SET config=EXCLUDED.config,secret=EXCLUDED.secret,webhook_secret=EXCLUDED.webhook_secret,enabled=EXCLUDED.enabled,checked_at=NULL,webhook_checked_at=NULL,updated_at=now()',[req.user.org_id,platform,source.config,source.secret,source.webhook_secret,source.enabled]);
      await audit(db,req.user,'capture.config_copied',null,{platform,sourcePlatform,enabled:source.enabled});
    });
    res.json({ok:true,sourcePlatform});
  }));
  app.post('/api/admin/capture/:platform/test',admin,wrap(async(req,res)=>{
    if(req.user.demo)throw fail(403,'Connection checks are unavailable in the sample workspace.');
    const platform=z.enum(capturePlatforms).parse(req.params.platform),c=(await query('SELECT * FROM capture_connections WHERE org_id=$1 AND platform=$2',[req.user.org_id,platform])).rows[0];
    if(!c?.secret)throw fail(409,'Save the capture configuration first.');
    await recallRequest(c,'bot/?limit=1');
    await query('UPDATE capture_connections SET checked_at=now() WHERE org_id=$1 AND platform=$2 AND secret=$3',[req.user.org_id,platform,c.secret]);
    res.json({ok:true,message:'API key accepted. This check does not join or record a meeting. Send a signed test webhook next.'});
  }));
  app.post('/api/meetings/:id/capture/start',requireRole('MEETING_ORGANIZER'),wrap(async(req,res)=>{
    const revision=z.number().int().parse(req.body.revision);
    await tx(async db=>{const m=await meetingFor(req.user,req.params.id,db,true);if(m.revision!==revision)throw fail(409,'Meeting changed. Refresh and try again.');if(!['SETUP_REQUIRED','DRAFT','FAILED'].includes(m.status)||m.file_path||(await db.query('SELECT 1 FROM transcripts WHERE meeting_id=$1',[m.id])).rowCount)throw fail(409,'Only an unrecorded remote assignment can start capture.');if(!await queueCapture(db,m))throw fail(409,`Complete the selected ${m.platform} capture method and its connection checks in Administration first.`);await audit(db,req.user,'capture.requested',m.id);});res.json({ok:true});
  }));
  app.post('/api/meetings/:id/capture/stop',requireRole('MEETING_ORGANIZER'),wrap(async(req,res)=>{
    const revision=z.number().int().parse(req.body.revision);await tx(async db=>{const m=await meetingFor(req.user,req.params.id,db,true);if(m.revision!==revision)throw fail(409,'Meeting changed. Refresh and try again.');if(!await queueCaptureStop(db,m))throw fail(409,'No remote capture session exists.');await audit(db,req.user,'capture.stop_requested',m.id);});res.json({ok:true});
  }));
  app.post('/api/meetings/:id/capture/recover',requireRole('MEETING_ORGANIZER'),wrap(async(req,res)=>{
    const m=await meetingFor(req.user,req.params.id);
    const s=(await query('SELECT * FROM capture_sessions WHERE meeting_id=$1',[m.id])).rows[0];
    if(!s||s.bot_id||!['UNKNOWN','DISPATCHING'].includes(s.state))throw fail(409,'This session does not need bot recovery.');
    if(s.config.captureMethod==='direct'){
      if(s.stop_requested)throw fail(409,'Stop was requested. Retry stop instead of dispatching.');
      await query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_CREATE') ON CONFLICT DO NOTHING",[randomUUID(),m.id]);
      await audit(pool,req.user,'capture.direct_dispatch_retried',m.id);res.json({ok:true});return;
    }
    const botId=z.uuid().parse(req.body.botId);
    const bot=await recallRequest(s,`bot/${botId}/`);if(bot.metadata?.minutes_meeting_id!==m.id)throw fail(400,'This bot does not belong to this meeting.');
    await tx(async db=>{await db.query("UPDATE capture_sessions SET bot_id=$2,state='CREATED' WHERE meeting_id=$1 AND bot_id IS NULL",[m.id,botId]);if(s.stop_requested)await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_STOP') ON CONFLICT DO NOTHING",[randomUUID(),m.id]);await audit(db,req.user,'capture.recovered',m.id,{botId});});res.json({ok:true});
  }));
  app.post('/api/meetings/:id/capture/import',requireRole('MEETING_ORGANIZER'),wrap(async(req,res)=>{
    const m=await meetingFor(req.user,req.params.id),s=(await query('SELECT * FROM capture_sessions WHERE meeting_id=$1',[m.id])).rows[0];
    if(!s?.recording_id||s.imported_at)throw fail(409,'No completed recording is waiting to be imported.');
    await query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_IMPORT') ON CONFLICT DO NOTHING",[randomUUID(),m.id]);res.json({ok:true});
  }));
  app.post('/api/meetings/:id/capture/recall-transcribe',requireRole('MEETING_ORGANIZER','REVIEWER'),wrap(async(req,res)=>{
    await tx(async db=>{const m=await meetingFor(req.user,req.params.id,db,true),s=(await db.query('SELECT * FROM capture_sessions WHERE meeting_id=$1 FOR UPDATE',[req.params.id])).rows[0];if(!s||s.config.captureMethod==='direct'||!s.bot_id||!s.recording_id)throw fail(409,'This meeting does not have a completed Recall.ai recording available for transcription.');if(s.state==='TRANSCRIBING')throw fail(409,'Recall transcription is already in progress.');await db.query('UPDATE capture_sessions SET state=$2,config=$3 WHERE meeting_id=$1',[m.id,'TRANSCRIBING',{...s.config,transcriptionProvider:'recall',recallTranscriptId:null,recallTranscriptImportedAt:null}]);await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_RECALL_TRANSCRIBE')",[randomUUID(),m.id]);await db.query("UPDATE meetings SET status='TRANSCRIBING_FINAL',error=NULL,revision=revision+1 WHERE id=$1",[m.id]);await audit(db,req.user,'capture.recall_transcription_requested',m.id,{recordingId:s.recording_id});});res.json({ok:true});
  }));
}

export function webhookApp() {
  const receiver=express();receiver.disable('x-powered-by');
  receiver.post('/api/capture/recall/:org/:platform',express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{
    try{
      const org=z.uuid().parse(req.params.org),platform={teams:'Teams',zoom:'Zoom'}[req.params.platform];if(!platform)throw fail(404,'Unknown capture platform.');
      const c=(await query('SELECT * FROM capture_connections WHERE org_id=$1 AND platform=$2',[org,platform])).rows[0];if(!c?.webhook_secret)throw fail(401,'Webhook not configured.');
      if(!Buffer.isBuffer(req.body))throw fail(400,'Use an application/json request body.');
      const id=verifyCaptureWebhook(decrypt(c.webhook_secret),req.headers,req.body);
      let payload;try{payload=JSON.parse(req.body.toString('utf8'));}catch{throw fail(400,'Invalid JSON.');}
      if(typeof payload.event!=='string')throw fail(400,'Missing event type.');
      await tx(async db=>{await db.query('INSERT INTO capture_webhooks(org_id,platform,event_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[org,platform,id,payload]);await db.query('UPDATE capture_connections SET webhook_checked_at=now() WHERE org_id=$1 AND platform=$2',[org,platform]);});
      res.status(202).json({accepted:true});
    }catch(e){res.status(e instanceof z.ZodError?400:e.status||500).json({error:e.status?e.message:'Webhook could not be accepted.'});}
  });return receiver;
}

export async function processCaptureEvent(db,event) {
  const p=event.payload,botId=p.data?.bot?.id;
  if(!captureEvents.includes(p.event)||!z.uuid().safeParse(botId).success)return;
  let s=(await db.query("SELECT * FROM capture_sessions WHERE bot_id=$1 AND org_id=$2 AND platform=$3 AND COALESCE(config->>'captureMethod','recall')='recall'",[botId,event.org_id,event.platform])).rows[0];
  if(!s){const meetingId=p.data?.bot?.metadata?.minutes_meeting_id;if(!z.uuid().safeParse(meetingId).success)return;
    s=(await db.query("SELECT * FROM capture_sessions WHERE meeting_id=$1 AND org_id=$2 AND platform=$3 AND bot_id IS NULL AND state IN ('DISPATCHING','UNKNOWN') AND COALESCE(config->>'captureMethod','recall')='recall'",[meetingId,event.org_id,event.platform])).rows[0];if(!s)return;
  }
  // Keep the meeting -> session lock order used by cancellation and import.
  const m=(await db.query('SELECT * FROM meetings WHERE id=$1 FOR UPDATE',[s.meeting_id])).rows[0];
  s=(await db.query('SELECT * FROM capture_sessions WHERE meeting_id=$1 FOR UPDATE',[s.meeting_id])).rows[0];
  if(!s||s.bot_id&&s.bot_id!==botId)return;
  if(!s.bot_id){
    if(!['DISPATCHING','UNKNOWN'].includes(s.state))return;
    await db.query('UPDATE capture_sessions SET bot_id=$2 WHERE meeting_id=$1',[s.meeting_id,botId]);
    if(s.stop_requested)await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_STOP') ON CONFLICT DO NOTHING",[randomUUID(),s.meeting_id]);
  }
  if(['transcript.done','transcript.failed'].includes(p.event)){
    if(s.config.transcriptionProvider!=='recall')return;
    const transcriptId=p.data?.transcript?.id;if(!z.uuid().safeParse(transcriptId).success)return;
    if(s.config.recallTranscriptId&&s.config.recallTranscriptId!==transcriptId)return;
    if(p.event==='transcript.failed'){
      await db.query("UPDATE capture_sessions SET state='ENDED' WHERE meeting_id=$1",[m.id]);
      await db.query('UPDATE meetings SET status=$2,error=$3,revision=revision+1 WHERE id=$1',[m.id,'FAILED',`Recall transcription failed (${String(p.data?.data?.sub_code||'unknown error').slice(0,120)}). Check the Recall dashboard, then retry or upload the recording for ElevenLabs transcription.`]);return;
    }
    await db.query("UPDATE capture_sessions SET state='TRANSCRIPT_READY',config=config || $2::jsonb WHERE meeting_id=$1",[m.id,JSON.stringify({recallTranscriptId:transcriptId})]);
    await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_RECALL_IMPORT_TRANSCRIPT')",[randomUUID(),m.id]);
    await db.query("UPDATE meetings SET status='TRANSCRIBING_FINAL',error=NULL,revision=revision+1 WHERE id=$1",[m.id]);return;
  }
  if(['READY_FOR_REVIEW','IN_REVIEW','APPROVED','REJECTED','GENERATING_MINUTES','TRANSCRIBING_FINAL'].includes(m.status))return;
  if(p.event==='recording.failed'){
    const rid=p.data?.recording?.id;
    if(!z.uuid().safeParse(rid).success||s.imported_at||s.state==='CANCELLED'||s.recording_id&&s.recording_id!==rid)return;
    await db.query("UPDATE capture_sessions SET recording_id=$2,state='ENDED' WHERE meeting_id=$1",[m.id,rid]);
    await db.query("UPDATE meetings SET status='FAILED',error='Recall could not process the recording. Check the recording in the Recall dashboard before retrying import.',revision=revision+1 WHERE id=$1",[m.id]);return;
  }
  if(p.event==='recording.done'){
    const rid=p.data?.recording?.id;if(!z.uuid().safeParse(rid).success)return;
    if(s.recording_id&&s.recording_id!==rid){await db.query("UPDATE meetings SET error='Multiple recording parts are available. Review all parts in the Recall dashboard; this deployment imports one recording per meeting.' WHERE id=$1",[m.id]);return;}
    if(s.imported_at||s.state==='CANCELLED')return;
    await db.query("UPDATE capture_sessions SET recording_id=$2,state='ENDED' WHERE meeting_id=$1",[m.id,rid]);
    await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_IMPORT') ON CONFLICT DO NOTHING",[randomUUID(),m.id]);
    await db.query("UPDATE meetings SET status='PROCESSING_RECORDING',error=NULL,revision=revision+1 WHERE id=$1",[m.id]);return;
  }
  const time=Date.parse(p.data?.data?.updated_at);if(!Number.isFinite(time)||s.last_event_at&&time<=new Date(s.last_event_at).getTime())return;
  // Retrieve the completed bot once for the authoritative status-change times.
  // This is deliberately queued rather than polled, so capture status remains webhook-led.
  if(p.event==='bot.done')await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_USAGE') ON CONFLICT DO NOTHING",[randomUUID(),m.id]);
  if(s.imported_at||s.recording_id||['CANCELLED','ENDED'].includes(s.state))return;
  const status=eventState(p.event);if(!status)return;
  const error=p.event==='bot.recording_permission_denied'?'Host denied recording permission. Ask the host to allow recording.':status==='FAILED'?`Capture failed (${String(p.data?.data?.sub_code||p.event).slice(0,120)}). Check the provider dashboard.`:null;
  await db.query('UPDATE capture_sessions SET state=$2,last_event_at=$3 WHERE meeting_id=$1',[m.id,p.event.replace('bot.',''),new Date(time)]);
  if(s.stop_requested&&!['PROCESSING_RECORDING','FAILED'].includes(status))return;
  await db.query('UPDATE meetings SET status=$2,error=$3,revision=revision+1 WHERE id=$1',[m.id,status,error]);
}
let eventsBusy=false;
export async function runCaptureEvents() {
  if(eventsBusy)return;eventsBusy=true;
  let event;
  try{await tx(async db=>{event=(await db.query('SELECT * FROM capture_webhooks WHERE processed_at IS NULL AND attempts<5 AND run_at<=now() ORDER BY received_at LIMIT 1 FOR UPDATE SKIP LOCKED')).rows[0];if(!event)return;await processCaptureEvent(db,event);await db.query('UPDATE capture_webhooks SET processed_at=now() WHERE org_id=$1 AND platform=$2 AND event_id=$3',[event.org_id,event.platform,event.event_id]);});}catch{if(event)await query("UPDATE capture_webhooks SET attempts=attempts+1,run_at=now()+interval '30 seconds',error='Processing failed; check server logs.' WHERE org_id=$1 AND platform=$2 AND event_id=$3",[event.org_id,event.platform,event.event_id]);console.error('Capture callback processing failed; event retained for retry.');}finally{eventsBusy=false;}
}

async function downloadAudio(url,filename) {
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!(u.hostname.endsWith('.amazonaws.com')||u.hostname.endsWith('.recall.ai')))throw fail(502,'Recording download host is not supported. Download the MP3 in Recall and upload it to this meeting.');
  const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(180000)});if(!r.ok||!r.body)throw fail(502,'Recording download failed. Retry import before the provider retention period expires.');
  const max=250*1024*1024;let bytes=0;
  if(Number(r.headers.get('content-length'))>max){await r.body.cancel();throw fail(413,'Remote recording exceeds the 250 MB limit.');}
  try{await pipeline(Readable.fromWeb(r.body),new Transform({transform(chunk,_encoding,cb){bytes+=chunk.length;cb(bytes>max?fail(413,'Remote recording exceeds the 250 MB limit.'):null,chunk);}}),createWriteStream(filename,{flags:'wx'}));if(!bytes)throw fail(502,'Remote recording was empty.');}catch(e){await unlink(filename).catch(()=>{});throw e;}
}
async function downloadRecallJson(url) {
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!(u.hostname.endsWith('.amazonaws.com')||u.hostname.endsWith('.recall.ai')))throw fail(502,'Recall transcript download host is not supported. Retrieve it from the Recall dashboard instead.');
  const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(60000)});if(!r.ok)throw fail(502,'Recall transcript download failed. Retry after checking the transcript artifact in Recall.');
  return r.json();
}
export async function runCaptureJob(job,m,dataDir,{transcribeAt=new Date()}={}) {
  let s=(await query('SELECT * FROM capture_sessions WHERE meeting_id=$1',[m.id])).rows[0];if(!s)throw fail(409,'Capture session is missing.');
  if(s.config.captureMethod==='direct')return runDirectJob(job,m,s,dataDir,{transcribeAt});
  if(job.type==='CAPTURE_CREATE'){
    if(s.bot_id||s.stop_requested)return;
    if(s.state!=='PENDING')throw fail(409,'Dispatch outcome is uncertain. Recover the bot ID from the Recall dashboard; do not send a duplicate.');
    const claimed=await query("UPDATE capture_sessions SET state='DISPATCHING' WHERE meeting_id=$1 AND state='PENDING' AND NOT stop_requested AND bot_id IS NULL RETURNING meeting_id",[m.id]);
    if(!claimed.rowCount)return;
    let bot;try{bot=await recallRequest(s,'bot/','POST',botRequest(m,s.config));}
    catch(e){const rejected=/HTTP (400|401|402|403|404|422)\./.test(e.message);await query('UPDATE capture_sessions SET state=$2 WHERE meeting_id=$1 AND bot_id IS NULL',[m.id,e.retryAfter?'PENDING':rejected?'REJECTED':'UNKNOWN']);throw e;}
    if(!z.uuid().safeParse(bot.id).success){await query("UPDATE capture_sessions SET state='UNKNOWN' WHERE meeting_id=$1",[m.id]);throw fail(502,'Capture response had no valid bot ID. Check the Recall dashboard before retrying.');}
    await tx(async db=>{s=(await db.query('SELECT * FROM capture_sessions WHERE meeting_id=$1 FOR UPDATE',[m.id])).rows[0];if(s.bot_id&&s.bot_id!==bot.id)throw fail(409,'Conflicting bot IDs. Review the Recall dashboard.');await db.query("UPDATE capture_sessions SET bot_id=$2,state=CASE WHEN last_event_at IS NULL THEN 'CREATED' ELSE state END WHERE meeting_id=$1",[m.id,bot.id]);if(s.stop_requested)await db.query("INSERT INTO jobs(id,meeting_id,type) VALUES($1,$2,'CAPTURE_STOP') ON CONFLICT DO NOTHING",[randomUUID(),m.id]);await audit(db,{org_id:m.org_id,id:m.owner_id},'capture.dispatched',m.id,{botId:bot.id,platform:m.platform});});
  } else if(job.type==='CAPTURE_STOP'){
    if(s.imported_at||['CANCELLED','ENDED'].includes(s.state))return;
    if(!s.bot_id)throw fail(409,'Recover the bot ID before stopping this session.');
    const bot=await recallRequest(s,`bot/${s.bot_id}/`);
    if(bot.join_at&&new Date(bot.join_at)>new Date()){
      await recallRequest(s,`bot/${s.bot_id}/`,'DELETE');
      await query("UPDATE capture_sessions SET state='CANCELLED' WHERE meeting_id=$1",[m.id]);await query("UPDATE meetings SET status='CANCELLED',error=NULL,revision=revision+1 WHERE id=$1",[m.id]);
    }else await recallRequest(s,`bot/${s.bot_id}/leave_call/`,'POST');
  } else if(job.type==='CAPTURE_USAGE'){
    if(!s.bot_id)return;
    const existing=await query("SELECT 1 FROM usage WHERE meeting_id=$1 AND provider='Recall.ai' AND model='meeting_bot' AND unit='bot_minute' LIMIT 1",[m.id]);
    if(existing.rowCount)return;
    const bot=await recallRequest(s,`bot/${s.bot_id}/`);
    const changes=Array.isArray(bot.status_changes)?bot.status_changes:[];
    const started=changes.find(change=>change?.code==='joining_call')?.created_at;
    const ended=[...changes].reverse().find(change=>change?.code==='done')?.created_at;
    const startedAt=Date.parse(started),endedAt=Date.parse(ended);
    if(!Number.isFinite(startedAt)||!Number.isFinite(endedAt)||endedAt<startedAt){const e=fail(502,'Recall bot usage is not ready yet. The meeting capture continues; retry usage retrieval later.');e.retryAfter=15;throw e;}
    await recordUsage(m,'Recall.ai','meeting_bot','bot_minute',(endedAt-startedAt)/60000);
  } else if(job.type==='CAPTURE_IMPORT'){
    if(s.imported_at)return;
    if(!s.recording_id)throw fail(409,'No completed recording is available yet.');
    const recording=await recallRequest(s,`recording/${s.recording_id}/`);
    if(recording.bot?.id!==s.bot_id)throw fail(502,'Recording does not belong to this capture session.');
    const audio=recording.media_shortcuts?.audio_mixed;
    if(audio?.status?.code!=='done'||audio?.format!=='mp3'||!audio?.data?.download_url)throw fail(502,'Mixed MP3 is not ready. Use Retry recording import after checking the Recall dashboard.');
    const filename=path.join(dataDir,`remote-${randomUUID()}.mp3`);await downloadAudio(audio.data.download_url,filename);
    try{await tx(async db=>{const current=(await db.query('SELECT * FROM meetings WHERE id=$1 FOR UPDATE',[m.id])).rows[0];const locked=(await db.query('SELECT * FROM capture_sessions WHERE meeting_id=$1 FOR UPDATE',[m.id])).rows[0];if(locked.imported_at||current.file_path||(await db.query('SELECT 1 FROM transcripts WHERE meeting_id=$1',[m.id])).rowCount)throw fail(409,'A recording or transcript already exists; remote import did not overwrite it.');const useRecall=locked.config.transcriptionProvider==='recall';await db.query('UPDATE meetings SET file_path=$2,file_name=$3,mime_type=$4,status=$5,error=NULL,revision=revision+1 WHERE id=$1',[m.id,filename,`${m.platform}-meeting.mp3`,'audio/mpeg','TRANSCRIBING_FINAL']);await db.query("UPDATE capture_sessions SET imported_at=now(),state=$2 WHERE meeting_id=$1",[m.id,useRecall?'TRANSCRIBING':'ENDED']);await db.query('INSERT INTO jobs(id,meeting_id,type,run_at) VALUES($1,$2,$3,$4)',[randomUUID(),m.id,useRecall?'CAPTURE_RECALL_TRANSCRIBE':'TRANSCRIBE',transcribeAt]);await audit(db,{org_id:m.org_id,id:m.owner_id},'capture.recording_imported',m.id,{recordingId:s.recording_id,transcriptionProvider:useRecall?'Recall.ai':'ElevenLabs'});});}catch(e){await unlink(filename).catch(()=>{});throw e;}
  } else if(job.type==='CAPTURE_RECALL_TRANSCRIBE'){
    if(s.config.transcriptionProvider!=='recall'||!s.recording_id)return;
    if(s.config.recallTranscriptId)return;
    const created=await recallRequest(s,`recording/${s.recording_id}/create_transcript/`,'POST',recallAsyncTranscriptRequest());
    if(!z.uuid().safeParse(created.id).success)throw fail(502,'Recall did not return a transcript ID. Check the recording in Recall before retrying.');
    await query("UPDATE capture_sessions SET state='TRANSCRIBING',config=config || $2::jsonb WHERE meeting_id=$1",[m.id,JSON.stringify({recallTranscriptId:created.id})]);
  } else if(job.type==='CAPTURE_RECALL_IMPORT_TRANSCRIPT'){
    const transcriptId=s.config.recallTranscriptId;if(!z.uuid().safeParse(transcriptId).success)throw fail(409,'Recall transcript ID is missing. Wait for the transcript completion callback.');
    const artifact=await recallRequest(s,`transcript/${transcriptId}/`),downloadUrl=artifact.data?.download_url;
    if(typeof downloadUrl!=='string')throw fail(502,'Recall transcript is not ready to download. Wait for its completion callback and retry.');
    const segments=recallTranscriptSegments(await downloadRecallJson(downloadUrl));if(!segments.length)throw fail(502,'Recall returned no transcribed speech. Check the recording and transcript in Recall.');
    await tx(async db=>{const current=(await db.query('SELECT * FROM meetings WHERE id=$1 FOR UPDATE',[m.id])).rows[0];const locked=(await db.query('SELECT * FROM capture_sessions WHERE meeting_id=$1 FOR UPDATE',[m.id])).rows[0];if(locked.config.recallTranscriptId!==transcriptId)throw fail(409,'A newer Recall transcript is already selected for this meeting.');await saveTranscription(db,current,segments,'Recall.ai · participant-attributed · Traditional Chinese normalized');await db.query("UPDATE capture_sessions SET state='ENDED',config=config || $2::jsonb WHERE meeting_id=$1",[m.id,JSON.stringify({recallTranscriptImportedAt:new Date().toISOString()})]);await audit(db,{org_id:m.org_id,id:m.owner_id},'capture.recall_transcript_imported',m.id,{recordingId:locked.recording_id,transcriptId});});
  }
}
