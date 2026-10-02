import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
export async function query(text,values=[]) {return pool.query(text,values);}
export async function tx(fn) {const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
export async function migrate(){await query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));}
export async function audit(db,user,action,meetingId=null,detail={}){await db.query('INSERT INTO audit(org_id,user_id,meeting_id,action,detail) VALUES($1,$2,$3,$4,$5)',[user.org_id,user.id,meetingId,action,detail]);}
export async function seedOrg(db,orgId,name,demo=false){
 await db.query('INSERT INTO organizations(id,name,demo) VALUES($1,$2,$3)',[orgId,name,demo]);
 const department=randomUUID(),team=randomUUID(),template=randomUUID();
 await db.query("INSERT INTO units(id,org_id,name,kind) VALUES($1,$2,'Project Delivery','department')",[department,orgId]);
 await db.query("INSERT INTO units(id,org_id,name,parent_id,kind) VALUES($1,$2,'Site Team',$3,'team')",[team,orgId,department]);
 await db.query('INSERT INTO templates(id,org_id,name,sections) VALUES($1,$2,$3,$4)',[template,orgId,'Project progress',JSON.stringify(['Progress update','Decisions','Actions','Open questions','Next meeting'])]);
 return {department,team,template};
}
