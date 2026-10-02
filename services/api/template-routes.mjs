import multer from 'multer';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { query, tx, audit } from './db.mjs';
import { validateDocxTemplate, renderDocxTemplate, starterDocx, sampleTemplateData, docxToPdf } from './docx-templates.mjs';
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:5}}).single('file');
const schema=z.object({name:z.string().trim().min(2).max(100),language:z.enum(['English','Traditional Chinese','Bilingual English / Traditional Chinese']),sections:z.array(z.string().trim().min(1).max(100)).min(1).max(20)});
const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function templateRoutes(app,{wrap,admin,fail}) {
  app.get('/api/templates',wrap(async(req,res)=>res.json((await query('SELECT id,name,version,language,sections,docx_name,docx_sha256,published FROM templates WHERE org_id=$1 ORDER BY name,version DESC',[req.user.org_id])).rows)));
  app.get('/api/templates/starter.docx',wrap(async(req,res)=>res.type(mime).attachment('minutes-template-starter.docx').send(await starterDocx())));
  app.get('/api/templates/:id/docx',wrap(async(req,res)=>{
    const t=(await query('SELECT docx_data,docx_name FROM templates WHERE id=$1 AND org_id=$2',[z.uuid().parse(req.params.id),req.user.org_id])).rows[0];
    if(!t?.docx_data)throw fail(404,'Word template not found.');res.type(mime).attachment('minutes-template.docx').send(t.docx_data);
  }));
  // Preview uses synthetic content only. Nothing is sent to an AI provider.
  app.post('/api/templates/preview',admin,upload,wrap(async(req,res)=>{
    if(!req.file||!req.file.originalname.toLowerCase().endsWith('.docx'))throw fail(400,'Choose a .docx file.');
    validateDocxTemplate(req.file.buffer);
    res.type('application/pdf').attachment('template-preview.pdf').send(await docxToPdf(renderDocxTemplate(req.file.buffer,sampleTemplateData())));
  }));
  app.post('/api/templates',admin,upload,wrap(async(req,res)=>{
    const body={...req.body};
    if(typeof body.sections==='string'){try{body.sections=JSON.parse(body.sections)}catch{throw fail(400,'Invalid section headings.')}}
    const v=schema.parse(body);
    let file=req.file;
    if(body.sourceTemplateId&&!file){
      const previous=(await query('SELECT docx_data,docx_name FROM templates WHERE id=$1 AND org_id=$2',[z.uuid().parse(body.sourceTemplateId),req.user.org_id])).rows[0];
      if(!previous)throw fail(404,'Template not found.');
      if(previous.docx_data)file={buffer:previous.docx_data,originalname:previous.docx_name};
    }
    if(file){if(!file.originalname.toLowerCase().endsWith('.docx'))throw fail(400,'Choose a .docx file.');validateDocxTemplate(file.buffer);}
    const result=await tx(async db=>{
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.user.org_id]);
      const version=(await db.query('SELECT COALESCE(MAX(version),0)+1 AS version FROM templates WHERE org_id=$1 AND name=$2',[req.user.org_id,v.name])).rows[0].version;
      const id=randomUUID();
      await db.query('INSERT INTO templates(id,org_id,name,version,language,sections,docx_data,docx_name,docx_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,req.user.org_id,v.name,version,v.language,JSON.stringify(v.sections),file?.buffer||null,file?.originalname||null,file?createHash('sha256').update(file.buffer).digest('hex'):null]);
      await audit(db,req.user,'template.published',null,{name:v.name,version,wordLayout:!!file});return{id};
    });res.status(201).json(result);
  }));
}
