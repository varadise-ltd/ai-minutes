import { z } from 'zod';
import { query, tx, audit } from './db.mjs';

const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a six-digit hex colour.');
const font = z.enum(['inter', 'system', 'arial', 'georgia', 'jhenghei']);
const logo = z.string().max(720000).nullable().refine(value => {
  if (value === null) return true;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 512000 || bytes.length < 24 || bytes.toString('base64') !== match[2]) return false;
  return match[1] === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16)==='IHDR'
    : match[1] === 'jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255
    : bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
}, 'Upload a PNG, JPEG or WebP logo up to 500 KB.');
export const brandSchema = z.object({
  name: z.string().trim().min(1).max(40), tagline: z.string().trim().max(100),
  logo, logoWidth: z.number().int().min(48).max(160), showName: z.boolean(),
  bodyFont: font, headingFont: font,
  accent: color, sidebar: color, background: color, link: color,
  radius: z.number().int().min(0).max(16)
}).strict().refine(v=>v.showName || !!v.logo, {message:'Show the platform name when no logo is uploaded.'});
export async function readBrand(org) {
  const row = (await query('SELECT brand,brand_revision FROM organizations WHERE id=$1',[org])).rows[0];
  return {config:row?.brand||null,revision:row?.brand_revision||1};
}
export function brandRoutes(app,{admin,wrap}) {
  app.get('/api/brand',wrap(async(req,res)=>res.set('Cache-Control','no-store').json(await readBrand(req.user.org_id))));
  app.put('/api/admin/brand',admin,wrap(async(req,res)=>{
    if(req.user.demo)throw Object.assign(new Error('Sample workspace: preview the brand here; save it in your company workspace.'),{status:403});
    const {config,revision}=z.object({config:brandSchema.nullable(),revision:z.number().int().positive()}).parse(req.body);
    await tx(async db=>{
      const result=await db.query('UPDATE organizations SET brand=$1,brand_revision=brand_revision+1 WHERE id=$2 AND brand_revision=$3 RETURNING id',[config,req.user.org_id,revision]);
      if(!result.rowCount)throw Object.assign(new Error('Brand settings changed in another session. Reload the saved settings before trying again.'),{status:409});
      await audit(db,req.user,config?'brand.updated':'brand.reset',null,{name:config?.name,hasLogo:!!config?.logo});
    });
    res.json(await readBrand(req.user.org_id));
  }));
}
