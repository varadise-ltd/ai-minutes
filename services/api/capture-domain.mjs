import { createHmac, timingSafeEqual } from 'node:crypto';
export const captureRegions = ['us-west-2','us-east-1','eu-central-1','ap-northeast-1'];
export const capturePlatforms = ['Teams','Zoom'];
export const captureEvents = ['bot.joining_call','bot.in_waiting_room','bot.in_call_not_recording','bot.in_call_recording','bot.recording_permission_denied','bot.call_ended','bot.done','bot.fatal','recording.done','recording.failed','transcript.done','transcript.failed'];
export const captureError = (status,message) => Object.assign(new Error(message),{status});
export function publicWebhookBase(value) {
  let u;try {u=new URL(value);}catch{throw captureError(400,'Enter your public HTTPS webhook base URL.');}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.port||u.pathname!=='/'||!u.hostname.includes('.')||/^\d+\./.test(u.hostname)||u.hostname.includes(':')||/(?:^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)||u.hostname.endsWith('.ts.net')) throw captureError(400,'Use a public HTTPS hostname without a path. A private Tailscale address or localhost cannot receive provider callbacks.');
  return u.origin;
}
export function verifyCaptureWebhook(secret,headers,raw,now=Date.now()) {
  const id=headers['webhook-id']??headers['svix-id'],timestamp=headers['webhook-timestamp']??headers['svix-timestamp'],signature=headers['webhook-signature']??headers['svix-signature'];
  if(!secret?.startsWith('whsec_')||typeof id!=='string'||id.length>200||!/^\d+$/.test(timestamp||'')||typeof signature!=='string'||Math.abs(now/1000-Number(timestamp))>300)throw captureError(401,'Invalid or expired webhook signature.');
  const expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${timestamp}.`).update(raw).digest();
  const valid=signature.split(' ').some(part=>{const [v,s]=part.split(',');if(v!=='v1'||!s)return false;const b=Buffer.from(s,'base64');return b.length===expected.length&&timingSafeEqual(b,expected);});
  if(!valid)throw captureError(401,'Invalid webhook signature.');
  return id;
}
export function botRequest(meeting,config,now=Date.now()) {
  return {meeting_url:meeting.join_url,bot_name:config.botName, ...(new Date(meeting.scheduled_at).getTime()>now+60000?{join_at:new Date(meeting.scheduled_at).toISOString()}:{}),recording_config:{audio_mixed_mp3:{},video_mixed_mp4:null},chat:{on_bot_join:{send_to:'everyone',message:config.notice}},metadata:{minutes_meeting_id:meeting.id},automatic_leave:{waiting_room_timeout:600,noone_joined_timeout:600,in_call_recording_timeout:Math.min(86400,meeting.duration_minutes*60+900)}};
}
export function recallAsyncTranscriptRequest() {
  return {provider:{recallai_async:{language_code:'auto'}},diarization:{use_separate_streams_when_available:true}};
}
function textFromWords(words) {
  return words.reduce((text,word)=>{
    const next=String(word?.text||'');if(!next)return text;
    const previous=text.at(-1)||'',first=next.trimStart().at(0)||'';
    const punctuation=/^[,.;:!?，。！？、）】]/.test(first),cjk=/[\u3400-\u9fff]/;
    return text+(!text||/^\s/.test(next)||/\s$/.test(text)||punctuation||(cjk.test(previous)&&cjk.test(first))?'':' ')+next;
  },'').trim();
}
export function recallTranscriptSegments(data) {
  if(!Array.isArray(data))return [];
  return data.map((part,index)=>{
    const words=Array.isArray(part?.words)?part.words:[],participant=part?.participant||{},participantId=participant.id===undefined||participant.id===null?`unmapped-${index+1}`:String(participant.id),name=String(participant.name||'').trim()||`Unmapped speaker ${index+1}`;
    const start=Number(words[0]?.start_timestamp?.relative)||0,end=Number(words.at(-1)?.end_timestamp?.relative)||start;
    return {id:`recall-${index+1}`,speaker:name,speakerId:`recall-${participantId}`,sourceSpeakerId:`recall-${participantId}`,start,end,text:textFromWords(words)};
  }).filter(segment=>segment.text);
}
export function eventState(event) {
  return {'bot.joining_call':'JOINING_CALL','bot.in_waiting_room':'WAITING_FOR_ADMISSION','bot.in_call_not_recording':'IN_CALL_NOT_RECORDING','bot.in_call_recording':'CAPTURING','bot.recording_permission_denied':'IN_CALL_NOT_RECORDING','bot.call_ended':'PROCESSING_RECORDING','bot.done':'PROCESSING_RECORDING','bot.fatal':'FAILED','recording.failed':'FAILED'}[event];
}
