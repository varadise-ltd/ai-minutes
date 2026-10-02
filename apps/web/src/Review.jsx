import React, { useState, useEffect, useRef } from 'react';
import { FileText, CheckCircle, NotePencil, UploadSimple, ArrowClockwise, FloppyDisk, PaperPlane, LockKey, Plus, LinkSimple, Trash, MagnifyingGlass, WarningCircle, Microphone, DownloadSimple, ClockCounterClockwise } from '@phosphor-icons/react';
import { api, formatDate, stamp, allowed } from './api';
import { Status, Button, Modal, Field } from './ui';
import { Speakers } from './Speakers';
import { ChangeMeetingTemplate } from './Templates';
import { RemoteCapture } from './CaptureSetup';
import { minutesItemsWithAttention } from './reviewAttention';
export function Review({
  detail: m,
  user,
  refresh,
  notify,
  action,
  onUpload,
  onRecord
}) {
  const latest = m.minutes?.[0],
    transcript = m.transcripts?.find(t => t.id === latest?.transcript_id) || m.transcripts?.[0];
  const [content, setContent] = useState(latest?.content),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [selectedEvidence, setSelectedEvidence] = useState('s2'),
    [query, setQuery] = useState(''),
    [showOriginal,setShowOriginal] = useState(false),
    [tab, setTab] = useState('evidence'),
    [editTranscript, setEditTranscript] = useState(false),
    [editSpeakers, setEditSpeakers] = useState(false),
    [editTemplate,setEditTemplate] = useState(false),
    [transcriptText, setTranscriptText] = useState(''),
    [reason, setReason] = useState(null),
    [version, setVersion] = useState('latest'),
    [itemFilter, setItemFilter] = useState('all');
  const audioRef = useRef();
  useEffect(() => {
    setContent(latest?.content);
    setDirty(false);
    setVersion('latest');
    setItemFilter('all');
  }, [m.id, latest?.id, latest?.revision]);
  const doc = version === 'latest' ? latest : m.minutes.find(v => String(v.version) === version),
    display = version === 'latest' ? content : doc?.content,
    editable = version === 'latest' && allowed(user, 'REVIEWER') && ['READY_FOR_REVIEW', 'REJECTED'].includes(m.status),
    source = m.transcripts?.find(t => t.id === doc?.transcript_id) || transcript;
  const itemValidation = version === 'latest' ? (m.validation || []) : [];
  const numberedItems = minutesItemsWithAttention(display?.items, itemValidation);
  const attentionItems = numberedItems.filter(entry => entry.issues.length);
  const visibleItems = itemFilter === 'attention' ? attentionItems : numberedItems;
  const hasDraft=!!(display?.summary?.trim()||display?.items?.some(item=>item.text?.trim()));
  const generating=m.status==='GENERATING_MINUTES';
  const canNameSpeakers=version==='latest'&&(editable||(['IN_REVIEW','APPROVED'].includes(m.status)&&allowed(user,'APPROVER')));
  function update(key, value) {
    setContent(c => ({
      ...c,
      [key]: value
    }));
    setDirty(true);
  }
  function updateItem(index, patch) {
    update('items', content.items.map((i, n) => n === index ? {
      ...i,
      ...patch,
      ...('text' in patch || 'evidence' in patch || 'quote' in patch || 'owner' in patch || 'dueDate' in patch ? {
        verified: false
      } : {})
    } : i));
  }
  async function save() {
    setBusy(true);
    try {
      await api(`/meetings/${m.id}/minutes`, {
        method: 'PUT',
        body: {
          content,
          revision: latest.revision
        }
      });
      await refresh();
      notify('Draft saved.');
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function process(endpoint) {
    setBusy(true);
    try {
      await api(`/meetings/${m.id}/${endpoint}`, {
        method: 'POST'
      });
      await refresh();
      notify('Processing queued. This page updates automatically.');
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  const usd = (m.usage || []).reduce((a, r) => a + Number(r.usd || 0), 0),
    hkd = (m.usage || []).reduce((a, r) => a + Number(r.hkd || 0), 0),
    missing = (m.usage || []).some(r => r.usd === null);
  const canRecord = !m.file_path && ['DRAFT', 'SETUP_REQUIRED'].includes(m.status) && allowed(user, 'MEETING_ORGANIZER');
  return <section className='review-workspace'>
<header className='page-header review-header'>
<div>
<span className='eyebrow'>MINUTES / REVIEW WORKSPACE</span>
<h1>{m.title}</h1>
<p>{formatDate(m.scheduled_at, {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          })} · {m.platform} · <Status value={m.status} />
</p>
</div>
<div className='header-buttons'>{editable && latest && <Button icon={FloppyDisk} disabled={busy || !dirty} onClick={save}>{dirty ? 'Save draft' : 'Saved'}</Button>}{['READY_FOR_REVIEW', 'REJECTED'].includes(m.status) && latest && allowed(user, 'REVIEWER') && <Button primary icon={PaperPlane} disabled={dirty || busy || !hasDraft} title={dirty ? 'Save your changes first' : ''} onClick={() => action('submit')}>Submit for approval</Button>}{m.status === 'IN_REVIEW' && allowed(user, 'APPROVER') && <>
<Button onClick={() => setReason('')}>Request changes</Button>
<Button primary icon={CheckCircle} onClick={() => action('approve')}>Approve minutes</Button>
</>}{m.status === 'APPROVED' && allowed(user, 'APPROVER') && <Button icon={NotePencil} onClick={() => action('reopen')}>Create revised version</Button>}</div>
</header>
<div className='review-progress'>{['Capture', 'Transcript', 'Review', 'Approval', 'Download'].map((s, i) => <div key={s} className={(latest ? i < 2 : m.file_path ? i === 0 : false) ? 'complete' : (m.status === 'APPROVED' ? i < 5 : false) ? 'complete' : i === 2 && latest ? 'current' : ''}>
<CheckCircle size={18} />
<span>{s}</span>
</div>)}</div>{m.error && <div className='notice warm review-alert'>{m.error}</div>}
<RemoteCapture meeting={m} user={user} refresh={refresh} notify={notify}/>
{canRecord && <div className='capture-entry'>
<div>
<strong>Record on this device</strong>
<p>Use your phone or computer microphone, then listen and upload.</p>
</div>
<Button primary icon={Microphone} onClick={onRecord}>Record audio</Button>
</div>}
{(editable||generating)&&source&&<div className='capture-entry ai-generation-entry' aria-live='polite'><div><strong>{generating?'AI is preparing your minutes…':hasDraft?'AI draft ready for your review':'Let AI prepare your minutes'}</strong><p>{generating?'The transcript is saved. Summary, discussions, decisions and actions are being generated.':hasDraft?'Review the draft and verify decisions and actions against the transcript. Regeneration keeps the previous version.':'Generate the summary, discussions, decisions and actions from this transcript. You do not need to add items manually.'}</p><small>{user.demo?'Sample workspace: external AI calls are disabled.':'Uses your configured Minutes AI provider; usage charges may apply.'}</small></div>{editable&&<Button primary disabled={busy||dirty||user.demo} onClick={()=>process('generate')}>{hasDraft?'Regenerate AI draft':'Generate AI minutes'}</Button>}</div>}
{canNameSpeakers && source && <div className='capture-entry'>
<div>
<strong>Who said what?</strong>
<p>Correct speaker labels if needed, then regenerate the draft to update names.</p>
</div>
<Button icon={NotePencil} disabled={dirty || busy} title={dirty ? 'Save your draft before editing speakers' : ''} onClick={() => setEditSpeakers(true)}>Name & correct speakers</Button>
</div>}
{editable&&<div className='capture-entry'><div><strong>Document appearance</strong><p>{doc?.template_snapshot?.docx_name?'Word layout: '+doc.template_snapshot.docx_name:'Standard layout · Upload a Word layout in Administration → Templates.'}</p></div><Button disabled={busy||dirty} onClick={()=>setEditTemplate(true)}>Change template</Button></div>}
{editTemplate&&<ChangeMeetingTemplate meeting={m} onClose={()=>setEditTemplate(false)} onSaved={refresh} notify={notify}/>}
{source?.source === 'Reviewer speaker correction' && editable && <p className='notice neutral review-alert'>Speaker labels were corrected. Review or regenerate the draft to update names in the minutes, then verify the evidence again.</p>}
{editSpeakers && <Speakers meeting={m} source={source} initialSpeakerId={typeof editSpeakers==='string'?editSpeakers:undefined} onClose={() => setEditSpeakers(false)} onSaved={refresh} notify={notify} />}
{!latest || !display ? <section className='processing-workspace'>
<div className='empty'>
<FileText size={42} />
<h2>{m.file_name || 'Start with a recording or transcript'}</h2>
<p>Upload an authorised recording, or supply a transcript to prepare your minutes.</p>
<div className='button-row'>{!m.file_path && <Button primary icon={UploadSimple} onClick={onUpload}>Upload recording</Button>}{m.file_path && <Button primary disabled={busy || m.status === 'TRANSCRIBING_FINAL'} onClick={() => process('process')}>{m.status === 'TRANSCRIBING_FINAL' ? 'Transcribing; AI minutes follow automatically…' : 'Transcribe & generate minutes'}</Button>}<Button icon={NotePencil} disabled={m.status==='TRANSCRIBING_FINAL'} onClick={() => {
            setEditTranscript(true);
            setTranscriptText('');
          }}>Add transcript manually</Button>
<Button icon={ArrowClockwise} onClick={refresh}>Refresh status</Button>
</div>
<p className='small muted'>{(m.capture?.method||m.captureMethod)==='recall'?'Recall.ai transcribes a remote bot recording with participant attribution where available.':'ElevenLabs transcribes phone, browser microphone, uploaded and direct-capture recordings.'} Minutes AI then generates a draft automatically. Chinese text uses Traditional Chinese. Provider usage charges may apply.</p>
</div>
</section> : <>
<div className='review-toolbar'>
<div>
<span className='version-pill'>{doc.status === 'APPROVED' ? <LockKey size={14} /> : <NotePencil size={14} />}Version {doc.version} · {doc.status.replaceAll('_', ' ')}</span>{dirty && <span className='unsaved'>Unsaved changes</span>}</div>
<div>
<select aria-label='Document version' value={version} onChange={e => {
            if (dirty) {
              notify('Save your changes before switching versions.');
              return;
            }
            setVersion(e.target.value);
          }}>
<option value='latest'>Latest version</option>{m.minutes.slice(1).map(v => <option key={v.id} value={v.version}>Version {v.version} · {v.status}</option>)}</select></div>
</div>
<div className='review-columns'>
<div className='minutes-document'>{latest.reviewer_comment && <div className='notice warm'>
<strong>Reviewer feedback:</strong> {latest.reviewer_comment}</div>}<div className='document-metadata'>
<span className='eyebrow'>MEETING MINUTES</span>
<h2>{m.title}</h2>
<p>{doc.template_snapshot?.name} · {doc.template_snapshot?.language || 'English'}</p>
</div>
{!hasDraft?<div className='empty'><FileText size={36}/><h3>{generating?'Generating your AI draft':'Your AI draft will appear here'}</h3><p>{generating?'You can read the saved transcript while the draft is prepared.':'Use Generate AI minutes above. Manual item entry is only needed for corrections after generation.'}</p></div>:<><Field label='Attendees'>
<input disabled={!editable} value={(display.attendees || []).join(', ')} onChange={e => update('attendees', e.target.value.split(',').map(s => s.trim()))} placeholder='Names confirmed in the meeting' />
</Field>
<Field label='Summary'>
<textarea className='summary-editor' disabled={!editable} value={display.summary} onChange={e => update('summary', e.target.value)} placeholder='Summarise using only supported information.' />
</Field>
<div className='section-heading minutes-items-heading'>
<h3>Discussion, decisions & actions</h3><div className='minutes-item-controls'><label className='inline-filter minutes-item-filter'>Show<select aria-label='Minutes item filter' value={itemFilter} onChange={e => setItemFilter(e.target.value)}><option value='all'>All items ({numberedItems.length})</option><option value='attention'>Attention required ({attentionItems.length})</option></select></label>{editable && <button className='text-button' onClick={() => update('items', [...content.items, {
              type: 'discussion',
              text: '',
              evidence: '',
              quote: '',
              owner: '',
              dueDate: '',
              verified: false
            }])}>
<Plus size={18} />Add missing item</button>}</div></div>{itemFilter === 'attention' && !visibleItems.length && <div className='attention-empty'><CheckCircle size={20} /><span>No minutes items currently require attention.</span></div>}{visibleItems.map(({ item, index, number, issues }) => <article key={index} className={'minutes-item ' + (selectedEvidence === item.evidence ? 'selected-evidence' : '') + (issues.length ? ' requires-attention' : '')}>
<div className='item-top'>
<span className='item-number'>Item {number}</span><select aria-label={`Item ${number} type`} disabled={!editable} value={item.type} onChange={e => updateItem(index, {
                type: e.target.value
              })}>{['discussion', 'decision', 'action', 'question'].map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select>
<button className='evidence-link' onClick={() => {
                setSelectedEvidence(item.evidence);
                setTab('evidence');
                const s = source?.segments.find(s => s.id === item.evidence);
                if (s && audioRef.current) audioRef.current.currentTime = s.start;
                document.getElementById('source-' + item.evidence)?.scrollIntoView({
                  block: 'nearest',
                  behavior: 'smooth'
                });
              }}>
<LinkSimple size={15} />{source?.segments.find(s => s.id === item.evidence) ? stamp(source.segments.find(s => s.id === item.evidence).start) : 'No evidence'}</button>{editable && <button className='icon-button' aria-label={`Remove item ${number}`} onClick={() => update('items', content.items.filter((_, n) => n !== index))}>
<Trash size={16} />
</button>}</div>
<textarea aria-label={`Item ${number} text`} disabled={!editable} value={item.text} onChange={e => updateItem(index, {
              text: e.target.value
            })} />{issues.length > 0 && <div className='item-attention' aria-label={`Item ${number} requires attention`}><WarningCircle size={16} /><div><strong>{issues.length} {issues.length === 1 ? 'check' : 'checks'} need attention</strong><ul>{issues.map((issue, issueIndex) => <li key={issueIndex}>{issue}</li>)}</ul></div></div>}{item.type === 'action' && <div className='form-grid'>
<Field label='Owner'>
<input disabled={!editable} placeholder='Not stated' value={item.owner} onChange={e => updateItem(index, {
                  owner: e.target.value
                })} />
</Field>
<Field label='Due date'>
<input disabled={!editable} type='date' value={item.dueDate} onChange={e => updateItem(index, {
                  dueDate: e.target.value
                })} />
</Field>
</div>}{editable && <details className='source-editor'>
<summary>Source reference & verification</summary>
<Field label='Transcript segment'>
<select value={item.evidence} onChange={e => {
                  const s = source.segments.find(s => s.id === e.target.value);
                  updateItem(index, {
                    evidence: e.target.value,
                    quote: s?.text || ''
                  });
                }}>
<option value=''>Select source evidence</option>{source?.segments.map(s => <option key={s.id} value={s.id}>{stamp(s.start)} · {s.speaker}</option>)}</select>
</Field>
<Field label='Exact source quote'>
<textarea value={item.quote} onChange={e => updateItem(index, {
                  quote: e.target.value
                })} />
</Field>{['decision', 'action'].includes(item.type) && <label className='checkbox'>
<input type='checkbox' checked={item.verified} onChange={e => updateItem(index, {
                  verified: e.target.checked
                })} />I checked this statement, owner and date against the source.</label>}</details>}{['decision', 'action'].includes(item.type) && <small className={item.verified ? 'verified' : 'needs-review'}>{item.verified ? <CheckCircle size={14} /> : <WarningCircle size={14} />} {item.verified ? 'Verified against source' : 'Source verification needed'}</small>}</article>)}<Field label='Next meeting'>
<input disabled={!editable} value={display.nextMeeting || ''} placeholder='Not stated' onChange={e => update('nextMeeting', e.target.value)} />
</Field>{itemValidation.length > 0 && editable && <div className='validation-note'>
<WarningCircle size={20} />
<div>
<strong>{itemValidation.length} checks need attention</strong>
<p><button className='validation-filter-link' onClick={() => setItemFilter('attention')}>Show the {attentionItems.length} affected {attentionItems.length === 1 ? 'item' : 'items'}</button> and open “Source reference & verification” before submitting.{dirty && ' Save to refresh these checks after your edits.'}</p>
</div>
</div>}</>}</div>
<aside className='evidence-pane'>
<div className='pane-tabs'>{[['evidence', 'Transcript'], ['costs', 'Usage & cost'], ['history', 'History']].map(([id, label]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>{tab === 'evidence' && <>
<div className='section-heading'>
<h2>Transcript evidence</h2>{canNameSpeakers&&<Button disabled={busy||dirty} onClick={()=>setEditSpeakers(true)}>Name speakers</Button>}{editable && <button className='icon-button' aria-label='Edit transcript' onClick={() => {
                setTranscriptText(JSON.stringify(source?.segments || [], null, 2));
                setEditTranscript(true);
              }}>
<NotePencil size={20} />
</button>}</div>
<div className='input-icon'>
<MagnifyingGlass size={19} />
<input placeholder='Search transcript…' aria-label='Search transcript' value={query} onChange={e => setQuery(e.target.value)} />
</div>
<p className='small muted'>{source?.source} · Transcript v{source?.version} · Final</p>
<label className='checkbox small'><input type='checkbox' checked={showOriginal} onChange={e=>setShowOriginal(e.target.checked)}/>Show original source text</label><p className='small muted'>Chinese is displayed in Traditional Chinese. Original source text is retained.</p>
<div className='transcript-segments'>{source?.segments.filter(s => (s.text + (s.displayText||'') + s.speaker).toLowerCase().includes(query.toLowerCase())).map(s => <article id={'source-' + s.id} className={'transcript-segment ' + (selectedEvidence === s.id ? 'highlighted' : '')} key={s.id}>
<button className='transcript-seek' aria-label={`Seek to ${stamp(s.start)}`} onClick={() => {
                setSelectedEvidence(s.id);
                if (audioRef.current) audioRef.current.currentTime = s.start;
              }}>
<time>{stamp(s.start)}</time></button>
<div>
{canNameSpeakers?<button className='speaker-name-button' aria-label={`Rename ${s.speaker} at ${stamp(s.start)}`} disabled={busy||dirty} onClick={()=>setEditSpeakers(s.speakerId||s.speaker||'unmapped')}><strong>{s.speaker}</strong><NotePencil size={16}/><span>Rename</span></button>:<strong>{s.speaker}</strong>}
<p>{showOriginal?(s.originalText||s.text):(s.displayText||s.text)}</p>
</div>
</article>)}</div>{m.file_path ? <audio ref={audioRef} controls src={`/api/meetings/${m.id}/audio`} /> : <div className='audio-unavailable'>
<Microphone size={19} /> {m.sample ? 'Sample transcript · no audio attached' : 'No audio file attached'}</div>}</>}{tab === 'costs' && <div className='cost-details'>
<h2>Usage & cost</h2>
<p className='muted'>Each entry preserves the provider, model, quantity, rate and exchange-rate snapshot.</p>
<div className='cost-total'>
<span>Calculated cost</span>
<strong>US${usd.toFixed(4)}</strong>
<span>HK${hkd.toFixed(4)}</span>
</div>{missing && <div className='notice warm'>Some usage has no matching rate. This total is incomplete.</div>}{m.usage.map(r => <div className='usage-line' key={r.id}>
<strong>{r.provider}</strong>
<span>{r.model} · {Number(r.quantity).toFixed(4)} {r.unit.replaceAll('_', ' ')}</span>
<span>{r.usd === null ? 'Rate missing' : `US$${Number(r.usd).toFixed(4)} / HK$${Number(r.hkd).toFixed(4)}`}</span>
<small>{r.status === 'SAMPLE' ? 'Illustrative sample only' : r.status === 'RATE_MISSING' ? 'No matching rate configured.' : 'Calculated; not invoice-reconciled.'}</small>
<small>FX: {r.rate_snapshot?.hkd_per_usd || '—'} HKD/USD</small>
</div>)}{!m.usage.length && <p>No paid provider usage has been recorded.</p>}</div>}{tab === 'history' && <div className='history-list'>
<h2>Meeting history</h2>{m.history.length ? m.history.map((e, i) => <div key={i}>
<ClockCounterClockwise size={17} />
<span>
<strong>{e.action.replaceAll('.', ' · ').replaceAll('_', ' ')}</strong>
<small>{formatDate(e.created_at, {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}</small>
</span>
</div>) : <p className='muted'>No changes recorded yet.</p>}</div>}</aside>
</div>
<footer className='review-footer'>
<div>
<strong>{m.sample ? 'Sample cost' : missing ? 'Partial calculated cost' : 'Calculated cost'}: US${usd.toFixed(2)} / HK${hkd.toFixed(2)}</strong>
<small>{m.sample ? 'Illustrative sample · No provider charges' : 'Provider usage × configured rates · Pending invoice reconciliation'}</small>
</div>
<div className='export-controls'>{['docx', 'pdf'].map(f => <a key={f} className='button' href={`/api/meetings/${m.id}/export/${f}?version=${doc.version}`} onClick={e => {
            if (dirty) {
              e.preventDefault();
              notify('Save your changes before downloading.');
            }
          }}>
<DownloadSimple size={18} />{f === 'docx' ? `Download ${doc.status === 'APPROVED' ? '' : 'draft '}DOCX` : 'PDF'}</a>)}<small>{doc.status === 'APPROVED' ? 'APPROVED VERSION' : 'DRAFT — NOT APPROVED'}</small>
</div>
</footer>
</>}
{editTranscript && <Modal title={source ? 'Edit transcript · new version' : 'Add transcript'} wide onClose={() => setEditTranscript(false)}>
<p className='muted'>Previous source versions are retained. Changes clear evidence verification. Plain text receives placeholder timestamps; use JSON segments for accurate times.</p>
<textarea className='transcript-editor' aria-label='Transcript text or segments' value={transcriptText} onChange={e => setTranscriptText(e.target.value)} placeholder='Paste the meeting transcript…' />
<footer className='modal-actions'>
<Button onClick={() => setEditTranscript(false)}>Cancel</Button>
<Button primary onClick={async () => {
          try {
            let segments;
            try {
              segments = JSON.parse(transcriptText);
            } catch {
              segments = transcriptText.split(/\n\s*\n/).filter(Boolean).map((text, i) => ({
                id: `s${i + 1}`,
                speaker: 'Unmapped speaker',
                start: 0,
                text
              }));
            }
            await api(`/meetings/${m.id}/transcript`, {
              method: 'PUT',
              body: {
                segments,
                revision: m.revision
              }
            });
            setEditTranscript(false);
            await refresh();
            notify('A new transcript version was saved.');
          } catch (e) {
            notify(e.message);
          }
        }}>Save transcript version</Button>
</footer>
</Modal>}{reason !== null && <Modal title='Request changes' onClose={() => setReason(null)}>
<Field label='Reason for returning the draft'>
<textarea value={reason} onChange={e => setReason(e.target.value)} required />
</Field>
<footer className='modal-actions'>
<Button onClick={() => setReason(null)}>Cancel</Button>
<Button primary disabled={!reason.trim()} onClick={async () => {
          await action('reject', reason);
          setReason(null);
        }}>Return to reviewer</Button>
</footer>
</Modal>}</section>;
}
