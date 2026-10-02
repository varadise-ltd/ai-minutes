import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {query,pool} from '../../services/api/db.mjs';

test('brand settings persist by company, restrict changes to admins, validate uploads and reject stale saves',async()=>{
 const org=randomUUID(),other=randomUUID(),admin=randomUUID(),member=randomUUID(),outsider=randomUUID();
 const base=process.env.TEST_URL||'http://127.0.0.1:5000';
 async function session(id){const token=randomBytes(32).toString('hex');await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),id]);return 'minutes_session='+token;}
 async function req(path,method='GET',body,cookie){const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 const config={name:'Harbour Minutes',tagline:'A clear shared record',logo:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6gAAAABJRU5ErkJggg==',logoWidth:120,showName:false,bodyFont:'jhenghei',headingFont:'georgia',accent:'#2563eb',sidebar:'#10243a',background:'#f6f8fc',link:'#1d4ed8',radius:8};
 try{
  for(const id of [org,other])await query('INSERT INTO organizations(id,name) VALUES($1,$2)',[id,'Brand regression '+id]);
  for(const [id,company,roles] of [[admin,org,['ORG_ADMIN']],[member,org,['MEMBER']],[outsider,other,['ORG_ADMIN']]])await query('INSERT INTO users(id,org_id,name,email,roles) VALUES($1,$2,$3,$4,$5)',[id,company,'Brand tester',id+'@example.invalid',roles]);
  const a=await session(admin),b=await session(member),c=await session(outsider);
  assert.equal((await req('/brand')).status,401);
  assert.deepEqual((await req('/brand','GET',null,a)).data,{config:null,revision:1});
  assert.equal((await req('/admin/brand','PUT',{config,revision:1},b)).status,403);
  const saved=await req('/admin/brand','PUT',{config,revision:1},a);assert.equal(saved.status,200);assert.equal(saved.data.revision,2);
  assert.deepEqual((await req('/brand','GET',null,b)).data.config,config);
  assert.deepEqual((await req('/brand','GET',null,c)).data,{config:null,revision:1});
  assert.equal((await req('/admin/brand','PUT',{config:{...config,name:'Stale'},revision:1},a)).status,409);
  for(const invalid of [{accent:'red;display:none'},{bodyFont:'url(https://external.invalid/font)'},{logo:'data:image/svg+xml;base64,PHN2Zy8+'},{logo:'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='},{logo:null,showName:false},{logoWidth:10000}])assert.equal((await req('/admin/brand','PUT',{config:{...config,...invalid},revision:2},a)).status,400);
  assert.equal((await req('/brand','GET',null,a)).data.revision,2);
  assert.equal((await query("SELECT count(*)::int AS n FROM audit WHERE org_id=$1 AND action='brand.updated'",[org])).rows[0].n,1);
  assert.equal((await req('/admin/brand','PUT',{config:null,revision:2},a)).status,200);
  assert.deepEqual((await req('/brand','GET',null,a)).data,{config:null,revision:3});
  await query('UPDATE organizations SET demo=true WHERE id=$1',[org]);
  assert.equal((await req('/admin/brand','PUT',{config,revision:3},a)).status,403);
 }finally{
  await query('DELETE FROM audit WHERE org_id=ANY($1::uuid[])',[[org,other]]);
  await query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[[admin,member,outsider]]);
  await query('DELETE FROM users WHERE org_id=ANY($1::uuid[])',[[org,other]]);
  await query('DELETE FROM organizations WHERE id=ANY($1::uuid[])',[[org,other]]);await pool.end();
 }
});
