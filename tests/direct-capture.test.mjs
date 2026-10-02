import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
process.env.ENCRYPTION_KEY ||= '0'.repeat(64); // Synthetic key for unit tests without a deployment .env.
const {workerOrigin,validateWorkerHealth,validateDirectSession,DIRECT_PROTOCOL}=await import('../services/api/direct-capture.mjs');
test('direct worker URLs require exact authorised origins and reject redirects/credential-style URLs',()=>{
 assert.equal(workerOrigin('http://host.docker.internal:8020/'),'http://host.docker.internal:8020');
 for(const value of ['http://169.254.169.254','http://host.docker.internal:8030','https://unapproved.example.com','http://key@host.docker.internal:8020','http://host.docker.internal:8020/api','http://host.docker.internal:8020?key=x'])assert.throws(()=>workerOrigin(value));
});
test('worker verification requires real protocol, account identity and platform capabilities',()=>{
 const config={clientId:'zoom-client',accountId:'zoom-account'};
 const health={protocol:DIRECT_PROTOCOL,platform:'Zoom',ready:true,...config,capabilities:{audio:true,schedule:true,stop:true,idempotentSessions:true,rtms:true}};
 assert.doesNotThrow(()=>validateWorkerHealth(health,'Zoom',config));
 for(const change of [{ready:false},{platform:'Teams'},{accountId:'other'},{protocol:'sample-server'},{capabilities:{audio:true}}])assert.throws(()=>validateWorkerHealth({...health,...change},'Zoom',config));
 const teams={clientId:randomUUID(),tenantId:randomUUID()};assert.throws(()=>validateWorkerHealth({...health,...teams,platform:'Teams'},'Teams',teams));
 assert.doesNotThrow(()=>validateWorkerHealth({...health,...teams,platform:'Teams',capabilities:{...health.capabilities,recordingStatus:true}},'Teams',teams));
});
test('worker state and audio metadata are bound to one meeting and platform',()=>{
 const s={meeting_id:randomUUID(),platform:'Zoom'},state={id:s.meeting_id,platform:'Zoom',state:'WAITING_FOR_HOST',updatedAt:new Date().toISOString()};
 assert.equal(validateDirectSession(state,s).state,'WAITING_FOR_HOST');
 for(const change of [{id:randomUUID()},{platform:'Teams'},{updatedAt:'yesterday'},{state:'COMPLETED'},{state:'RECORDING_NOW'}])assert.throws(()=>validateDirectSession({...state,...change},s));
 assert.equal(validateDirectSession({...state,state:'COMPLETED',audio:{mime:'audio/wav',bytes:44}},s).audio.bytes,44);
 assert.throws(()=>validateDirectSession({...state,state:'COMPLETED',audio:{mime:'audio/wav',bytes:300*1024*1024}},s));
});
