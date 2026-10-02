import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import InspectModule from 'docxtemplater/js/inspect-module.js';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Footer, PageNumber } from 'docx';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const fields = new Set(['title','referenceNumber','status','date','time','timezone','attendees','summary','nextMeeting','version','templateName','items','discussions','decisions','actions','questions','number','type','text','owner','dueDate','evidence','quote','speaker','timestamp']);
const bad = message => Object.assign(new Error(message), {status:400});
const stamp = seconds => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;

function compile(buffer) {
  if (!buffer?.length || buffer.length > 5*1024*1024) throw bad('Upload a DOCX template up to 5 MB.');
  let zip;
  try { zip = new PizZip(buffer); } catch { throw bad('This file is not a readable DOCX. Save it as .docx in Word.'); }
  const entries = Object.values(zip.files);
  if (entries.length > 1000 || entries.reduce((n,e)=>n+(e._data?.uncompressedSize||0),0)>25*1024*1024) throw bad('The expanded template exceeds 25 MB or 1,000 files.');
  if (!zip.file('word/document.xml') || !zip.file('[Content_Types].xml')) throw bad('Upload a Word DOCX document.');
  for (const entry of entries) {
    if (/vbaProject|embeddings\/|activeX\//i.test(entry.name)) throw bad('Templates cannot contain macros, embedded files or ActiveX controls.');
    if (/\.(xml|rels)$/i.test(entry.name)) {
      const xml = entry.asText();
      if (/\{\s*[@%:~]/.test(xml.replace(/<[^>]*>/g,''))) throw bad('Raw XML and executable/module placeholders are not supported.');
      if (/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External|<w:altChunk|INCLUDETEXT|INCLUDEPICTURE|DDEAUTO/i.test(xml)) throw bad('Remove external links, linked images and embedded document fields from the template.');
    }
  }
  const inspect = new InspectModule();
  let doc;
  try {
    doc = new Docxtemplater(zip, {
      paragraphLoop:true, linebreaks:true, errorLogging:false, modules:[inspect],
      parser(tag) {
        if (!fields.has(tag)) throw bad(`Unsupported placeholder: ${tag}. Use the starter template fields.`);
        return {get:scope=>Object.hasOwn(scope,tag)?scope[tag]:undefined};
      },
      nullGetter:()=>''
    });
  } catch (e) { throw bad('Template placeholders are invalid. '+(e.properties?.errors?.map(x=>x.properties?.explanation||x.message).join(' ')||e.message)); }
  const tags = inspect.getAllTags();
  for (const group of Object.values(tags)) {
    if (group && Object.values(group).some(value=>value && Object.keys(value).length)) throw bad('Nested loops are not supported. Use one loop for each minutes section.');
  }
  if (!Object.hasOwn(tags,'title') || !Object.hasOwn(tags,'summary')) throw bad('Template must contain {title} and {summary} outside a loop.');
  if (!tags.items && !['discussions','decisions','actions','questions'].every(k=>tags[k])) throw bad('Include an {#items}…{/items} loop, or all four section loops: discussions, decisions, actions and questions.');
  const groups = tags.items ? [tags.items] : ['discussions','decisions','actions','questions'].map(k=>tags[k]);
  if (groups.some(group=>!Object.hasOwn(group,'text'))) throw bad('Each minutes loop must include {text}.');
  return {doc,tags};
}

export function validateDocxTemplate(buffer) {
  const {tags} = compile(buffer);
  // Rendering also detects unsupported raw XML/module tags and invalid loops.
  renderDocxTemplate(buffer, sampleTemplateData());
  return Object.keys(tags);
}

export function templateData(meeting,minutes,segments) {
  const chinese = /Chinese/.test(minutes.template_snapshot?.language||'');
  const labels = chinese ? {discussion:'討論',decision:'決議',action:'跟進事項',question:'待確認事項'} : {discussion:'Discussion',decision:'Decision',action:'Action',question:'Open question'};
  const absent = chinese?'未提及':'Not stated';
  const start = new Date(meeting.scheduled_at);
  const timeZone = meeting.timezone || 'Asia/Hong_Kong';
  const dateParts = new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'numeric',day:'numeric'}).formatToParts(start);
  const part = name => dateParts.find(value=>value.type===name)?.value;
  const date = chinese ? `${part('year')} 年 ${Number(part('month'))} 月 ${Number(part('day'))} 日` : new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'long',day:'numeric'}).format(start);
  const formatTime = value => new Intl.DateTimeFormat('en-GB',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value);
  const time = `${formatTime(start)} - ${formatTime(new Date(start.getTime() + meeting.duration_minutes * 60000))}`;
  const items = minutes.content.items.map((item,index)=>{
    const source=segments.find(s=>s.id===item.evidence);
    return {...item,number:index+1,type:labels[item.type],owner:item.owner||absent,dueDate:item.dueDate||absent,evidence:source?`${stamp(source.start)} · ${source.speaker}`:absent,speaker:source?.speaker||'',timestamp:source?stamp(source.start):'',quote:item.quote||''};
  });
  const status = minutes.status==='APPROVED'?(chinese?'已批准':'APPROVED'):(chinese?'草稿 — 未經批准':'DRAFT — NOT APPROVED');
  return {title:meeting.title,referenceNumber:meeting.reference_number||absent,status:status+(meeting.sample?' · SAMPLE DATA — NOT A REAL MEETING RECORD':''),date,time,timezone:timeZone,attendees:(minutes.content.attendees||[]).join(', ')||absent,summary:minutes.content.summary,nextMeeting:minutes.content.nextMeeting||absent,version:minutes.version,templateName:minutes.template_snapshot?.name||'',items,...Object.fromEntries([['discussions','discussion'],['decisions','decision'],['actions','action'],['questions','question']].map(([key,type])=>[key,items.filter((_,index)=>minutes.content.items[index].type===type)]))};
}

export function renderDocxTemplate(buffer,data) {
  const {doc} = compile(buffer);
  try { doc.render(data); } catch { throw bad('The template could not be filled. Check its placeholders and loops.'); }
  const zip=doc.getZip();
  // The approval/sample label is always present, even if a template omits it.
  const escaped=String(data.status).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  zip.file('word/document.xml',zip.file('word/document.xml').asText().replace('<w:body>','<w:body><w:p><w:r><w:rPr><w:b/><w:color w:val="666666"/></w:rPr><w:t>'+escaped+'</w:t></w:r></w:p>'));
  return zip.generate({type:'nodebuffer',compression:'DEFLATE'});
}

export function sampleTemplateData() {
  return templateData({title:'項目協調會議',reference_number:'M003_2026',scheduled_at:'2026-09-16T02:00:00Z',timezone:'Asia/Hong_Kong',duration_minutes:60,sample:true},{version:1,status:'DRAFT',template_snapshot:{name:'Word layout',language:'Traditional Chinese'},content:{summary:'本範例展示摘要、討論及跟進事項的排版。所有內容均為測試資料。',attendees:['陳先生','李女士'],nextMeeting:'未提及',items:[{type:'discussion',text:'與會者討論項目進度及文件提交安排。',evidence:'s1',quote:'我們今天討論項目進度。'},{type:'action',text:'李女士將整理文件清單，提交日期尚待確認。',owner:'李女士',evidence:'s2',quote:'我會整理文件清單。'}]}},[{id:'s1',start:15,speaker:'陳先生'},{id:'s2',start:48,speaker:'李女士'}]);
}

export async function starterDocx() {
  const p = (text,heading) => new Paragraph({heading,children:[new TextRun(text)]});
  return Packer.toBuffer(new Document({styles:{default:{document:{run:{font:'Noto Sans CJK TC',size:22},paragraph:{spacing:{after:140}}}}},sections:[{properties:{page:{margin:{top:1134,bottom:1134,left:1134,right:1134}}},footers:{default:new Footer({children:[new Paragraph({children:[new TextRun('會議紀錄 | '),new TextRun({children:[PageNumber.CURRENT]})]})]})},children:[p('{title}',HeadingLevel.TITLE),p('會議編號：{referenceNumber}'),p('{date}　{time} ({timezone})'),p('出席者：{attendees}'),p('會議摘要',HeadingLevel.HEADING_1),p('{summary}'),p('討論 決議及跟進事項',HeadingLevel.HEADING_1),p('{#items}'),p('{number}. {text}',HeadingLevel.HEADING_2),p('負責人：{owner}　期限：{dueDate}'),p('來源：{evidence}'),p('{quote}'),p('{/items}'),p('下次會議',HeadingLevel.HEADING_1),p('{nextMeeting}')]}]}));
}

// Each conversion has an isolated LibreOffice profile; concurrent exports do
// not contend for a shared profile or read another meeting's temporary files.
export async function docxToPdf(buffer) {
  const dir=await mkdtemp(path.join(tmpdir(),'minutes-export-'));
  try {
    await writeFile(path.join(dir,'minutes.docx'),buffer);
    await exec('libreoffice',['-env:UserInstallation='+pathToFileURL(path.join(dir,'profile')).href,'--headless','--convert-to','pdf','--outdir',dir,path.join(dir,'minutes.docx')],{timeout:60000,maxBuffer:1024*1024});
    return await readFile(path.join(dir,'minutes.pdf'));
  } catch { throw Object.assign(new Error('PDF conversion failed. Download DOCX, or retry the PDF export.'),{status:503}); }
  finally { await rm(dir,{recursive:true,force:true}); }
}
