import { randomUUID } from 'node:crypto';
import { tx, seedOrg } from './db.mjs';
export async function seedDemo(){return tx(async db=>{
 await db.query("SELECT pg_advisory_xact_lock(17091601)");
 const existing=await db.query("SELECT u.* FROM users u JOIN organizations o ON o.id=u.org_id WHERE o.demo=true AND u.email='demo@local.invalid'");
 if(existing.rows.length)return existing.rows[0];
 const org=randomUUID();const {department,team,template}=await seedOrg(db,org,'Harbour Projects',true);
 const user={id:randomUUID(),org_id:org,name:'Emily Chan',email:'demo@local.invalid',roles:['ORG_ADMIN','MEETING_ORGANIZER','REVIEWER','APPROVER'],unit_ids:[department,team]};
 await db.query('INSERT INTO users(id,org_id,name,email,roles,unit_ids) VALUES($1,$2,$3,$4,$5,$6)',[user.id,org,user.name,user.email,user.roles,user.unit_ids]);
 for(const [name,email,roles] of [['Alex Chan','alex@example.invalid',['REVIEWER']],['Morgan Lee','morgan@example.invalid',['APPROVER']],['Jordan Wong','jordan@example.invalid',['MEMBER']]]) {
  await db.query('INSERT INTO users(id,org_id,name,email,roles,unit_ids) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),org,name,email,roles,[team]]);
 }
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong'}).format(new Date());
 const segments=[{id:'s1',speaker:'Alex Chan',start:18,text:'The structural works remain on schedule. The site team will continue monitoring progress.'},{id:'s2',speaker:'Morgan Lee',start:872,text:'We agreed to retain the current access route until the revised plan is reviewed. Morgan Lee will share the revised access plan by 2026-09-23.'},{id:'s3',speaker:'Alex Chan',start:889,text:'The signage requirements still need to be confirmed. An owner and deadline were not agreed.'}];
 const content={summary:'The team reviewed site progress and agreed to retain the current access route pending review of the revised plan.',attendees:['Alex Chan','Morgan Lee'],items:[{type:'discussion',text:'Structural works remain on schedule.',evidence:'s1',quote:segments[0].text,owner:'',dueDate:'',verified:false},{type:'decision',text:'Retain the current access route until the revised plan is reviewed.',evidence:'s2',quote:segments[1].text,owner:'',dueDate:'',verified:false},{type:'action',text:'Share the revised access plan.',evidence:'s2',quote:segments[1].text,owner:'Morgan Lee',dueDate:'2026-09-23',verified:false},{type:'question',text:'Who will confirm the signage requirements, and by when?',evidence:'s3',quote:segments[2].text,owner:'',dueDate:'',verified:false}]};
 for(const [title,time,platform,status] of [['Design coordination','09:30','Teams','READY_FOR_REVIEW'],['Site progress meeting','11:00','Teams','WAITING_FOR_ADMISSION'],['Commercial review','14:00','Zoom','SCHEDULED'],['Weekly team briefing','16:00','Teams','DRAFT'],['Facade coordination','10:00','Upload','READY_FOR_REVIEW']]){
  const id=randomUUID();let date=today;if(title==='Facade coordination'){const d=new Date();d.setDate(d.getDate()-1);date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong'}).format(d);}
  await db.query('INSERT INTO meetings(id,org_id,unit_id,owner_id,reviewer_id,title,platform,scheduled_at,status,template_id,consent,sample) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,true,true)',[id,org,team,user.id,title,platform,`${date}T${time}:00+08:00`,status,template]);
  if(status==='READY_FOR_REVIEW'){
   const tid=randomUUID();await db.query("INSERT INTO transcripts(id,meeting_id,version,segments,source) VALUES($1,$2,1,$3,'Sample fixture')",[tid,id,JSON.stringify(segments)]);
   await db.query('INSERT INTO minutes(id,meeting_id,version,transcript_id,content,template_snapshot) VALUES($1,$2,1,$3,$4,$5)',[randomUUID(),id,tid,content,{name:'Project progress',version:1,language:'English'}]);
   await db.query("INSERT INTO usage(id,meeting_id,provider,model,unit,quantity,usd,hkd,status,rate_snapshot) VALUES($1,$2,'ElevenLabs','sample','audio_minute',48,0.84,6.552,'SAMPLE',$3)",[randomUUID(),id,{usd_rate:'0.0175',hkd_per_usd:'7.80',note:'Illustrative sample only'}]);
  }
 }
 return user;
});}
