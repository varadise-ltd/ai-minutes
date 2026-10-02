import test from 'node:test';import assert from 'node:assert/strict';import {createHmac,randomBytes} from 'node:crypto';
import {verifyCaptureWebhook,botRequest,eventState,publicWebhookBase} from '../services/api/capture-domain.mjs';
test('capture webhook authenticates raw bytes, timestamp and rotating signatures',()=>{
 const key=randomBytes(32),secret='whsec_'+key.toString('base64'),now=Date.now(),t=String(Math.floor(now/1000)),body=Buffer.from('{"event":"bot.done"}'),id='msg_test';
 const signature=createHmac('sha256',key).update(`${id}.${t}.`).update(body).digest('base64');
 const h={'webhook-id':id,'webhook-timestamp':t,'webhook-signature':`v1,invalid v1,${signature}`};
 assert.equal(verifyCaptureWebhook(secret,h,body,now),id);
 assert.equal(verifyCaptureWebhook(secret,{'svix-id':id,'svix-timestamp':t,'svix-signature':`v1,${signature}`},body,now),id);
 assert.throws(()=>verifyCaptureWebhook(secret,h,Buffer.from('{}'),now),{status:401});assert.throws(()=>verifyCaptureWebhook(secret,h,body,now+301000),{status:401});assert.throws(()=>verifyCaptureWebhook(secret,{},body,now),{status:401});
});
test('bot payload schedules future meetings, identifies source and requests mixed MP3',()=>{
 const now=Date.now(),m={id:'meeting-test',join_url:'https://zoom.us/j/123?pwd=test',scheduled_at:new Date(now+1200000),duration_minutes:60},c={botName:'AI Minutes',notice:'Consented recording notice'};
 const body=botRequest(m,c,now);assert.equal(body.meeting_url,m.join_url);assert.equal(body.join_at,m.scheduled_at.toISOString());assert.deepEqual(body.recording_config,{audio_mixed_mp3:{},video_mixed_mp4:null});assert.equal(body.metadata.minutes_meeting_id,m.id);assert.equal(body.chat.on_bot_join.send_to,'everyone');assert.equal(body.automatic_leave.waiting_room_timeout,600);
 assert.equal(botRequest({...m,scheduled_at:new Date(now)},c,now).join_at,undefined);
 assert.equal(eventState('bot.joining_call'),'JOINING_CALL');assert.equal(eventState('bot.in_waiting_room'),'WAITING_FOR_ADMISSION');assert.equal(eventState('bot.in_call_not_recording'),'IN_CALL_NOT_RECORDING');assert.equal(eventState('bot.in_call_recording'),'CAPTURING');assert.equal(eventState('unknown'),undefined);
});
test('public callback configuration rejects local addresses and embedded credentials',()=>{
 assert.equal(publicWebhookBase('https://meeting.example.com/'),'https://meeting.example.com');
 for(const url of ['http://meeting.example.com','https://localhost','https://127.0.0.1','https://10.0.0.1','https://host.ts.net','https://user:secret@meeting.example.com','https://meeting.example.com/path','https://meeting.example.com?key=x'])assert.throws(()=>publicWebhookBase(url),{status:400});
});
