import React,{useEffect,useState} from 'react';
import {api} from './api';
import {Button,Modal,Field} from './ui';

export function TemplateDialog({value:v,onClose,onSaved,notify}) {
  const [busy,setBusy]=useState(false),[file,setFile]=useState(null),[error,setError]=useState('');
  async function preview(){
    setBusy(true);setError('');
    try{
      const body=new FormData();body.set('file',file);
      const response=await fetch('/api/templates/preview',{method:'POST',body});
      if(!response.ok)throw new Error((await response.json()).error);
      const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='template-preview.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      notify('Sample PDF downloaded. Review it before publishing.');
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function submit(e){
    e.preventDefault();setBusy(true);setError('');
    const form=new FormData(e.currentTarget);
    form.set('sections',JSON.stringify(String(form.get('sections')).split('\n').map(s=>s.trim()).filter(Boolean)));
    if(!file)form.delete('file');
    if(v?.docx_name&&!file)form.set('sourceTemplateId',v.id);
    try{await api('/templates',{method:'POST',body:form});notify('Template version published.');await onSaved()}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <Modal title={v?'Publish a new template version':'Publish minutes template'} onClose={()=>{if(!busy)onClose()}} wide>
    <p>Control your document in Word: logo, header/footer, tables, fonts, spacing and page size. The app fills the placeholders and uses the same Word layout for PDF.</p>
    <p><a className='text-button' href='/api/templates/starter.docx'>Download starter DOCX</a>{v?.docx_name&&<> · <a href={`/api/templates/${v.id}/docx`}>Download current Word layout</a></>}</p>
    <form onSubmit={submit}>
      <Field label='Template name'><input name='name' required minLength={2} maxLength={100} defaultValue={v?.name}/></Field>
      <Field label='Output language'><select name='language' defaultValue={v?.language==='Simplified Chinese'?'Traditional Chinese':v?.language||'Traditional Chinese'}>{['Traditional Chinese','English','Bilingual English / Traditional Chinese'].map(l=><option key={l}>{l}</option>)}</select></Field>
      <Field label='Word layout (.docx)' hint={v?.docx_name?`Current layout: ${v.docx_name}. Leave blank to retain it.`:'Up to 5 MB. Optional: leave blank to use the standard layout.'}><input name='file' type='file' accept='.docx' disabled={busy} onChange={e=>{setFile(e.target.files[0]||null);setError('')}}/></Field>
      {file&&<Button type='button' disabled={busy} onClick={preview}>Validate & download sample PDF</Button>}
      <details className='template-help'><summary>How to prepare your Word template</summary>
        <p>Start with the downloaded file, or add placeholders to your company document. Keep <code>{'{title}'}</code> and <code>{'{summary}'}</code>. Use <code>{'{#items}'}</code> and <code>{'{/items}'}</code> to repeat minutes, with <code>{'{text}'}</code> inside.</p>
        <p>Other fields: <code>{'{referenceNumber} {date} {time} {timezone} {attendees} {nextMeeting} {version} {status}'}</code>. Inside each item: <code>{'{number} {type} {owner} {dueDate} {evidence} {quote}'}</code>. You can put a loop in a table row. Separate section loops are also supported: discussions, decisions, actions and questions; include all four.</p>
        <p>The approval label is always added. Static logos must be embedded. Macros, external links and nested loops are not supported. An ordinary DOCX without placeholders needs these fields added before upload.</p>
      </details>
      <Field label='Content guidance — section headings (one per line)'><textarea name='sections' required rows={5} defaultValue={(v?.sections||['會議摘要','討論事項','決議','跟進事項','待確認事項','下次會議']).join('\n')}/></Field>
      <p className='small muted'>These headings guide AI content. The uploaded Word file controls export appearance. Publishing creates a new version; existing minutes retain their previous layout.</p>
      {error&&<p role='alert' className='notice warm'>{error}</p>}
      <footer className='modal-actions'><Button type='button' disabled={busy} onClick={onClose}>Cancel</Button><Button primary disabled={busy}>{busy?'Working…':'Publish version'}</Button></footer>
    </form>
  </Modal>;
}

export function ChangeMeetingTemplate({meeting,onClose,onSaved,notify}) {
  const [templates,setTemplates]=useState([]),[value,setValue]=useState(meeting.template_id),[busy,setBusy]=useState(false);
  useEffect(()=>{api('/templates').then(setTemplates).catch(e=>notify(e.message))},[]);
  return <Modal title='Choose document template' onClose={()=>{if(!busy)onClose()}}>
    <p>Choose the layout and output language. Current text is retained in a new document version. Regenerate with AI if the language or content guidance changes.</p>
    <Field label='Published template'><select value={value} onChange={e=>setValue(e.target.value)}>{templates.map(t=><option key={t.id} value={t.id}>{t.name} · v{t.version} · {t.language}{t.docx_name?' · Word layout':''}</option>)}</select></Field>
    <p className='small muted'>Upload a company Word layout in Administration → Templates.</p>
    <footer className='modal-actions'><Button disabled={busy} onClick={onClose}>Cancel</Button><Button primary disabled={busy||value===meeting.template_id||!templates.length} onClick={async()=>{setBusy(true);try{await api(`/meetings/${meeting.id}/template`,{method:'PUT',body:{templateId:value,revision:meeting.revision}});await onSaved();onClose();notify('Template applied in a new version.')}catch(e){notify(e.message)}finally{setBusy(false)}}}>Apply template</Button></footer>
  </Modal>;
}
