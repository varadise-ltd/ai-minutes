import React, { useEffect, useState } from 'react';
import { Plugs, UsersThree, Buildings, BookOpen, CurrencyDollar, Rows, ClockCounterClockwise, ArrowClockwise, Plus, Waveform, NotePencil, VideoCamera, ShieldCheck } from '@phosphor-icons/react';
import { api, formatDate, localInput } from './api';
import { Button, Modal, Field, Empty } from './ui';
import { TemplateDialog } from './Templates';
import { CaptureSetup } from './CaptureSetup';
import { BrandSettings } from './Brand';
import { newPasswordProps, passwordHint } from './passwordPolicy';
export function Admin({
  user,
  units,
  refresh,
  notify,
  onBrandSaved,
  onMyAccount
}) {
  const [tab, setTab] = useState('connections'),
    [cache, setCache] = useState({}),
    [modal, setModal] = useState(null),
    [busy, setBusy] = useState(false);
  const tabs = [['connections', 'Connections', Plugs], ['brand', 'Brand', NotePencil], ['people', 'People & access', UsersThree], ['structure', 'Organisation', Buildings], ['templates', 'Templates', BookOpen], ['rates', 'API rates & FX', CurrencyDollar], ['usage', 'Usage', Rows], ['audit', 'Audit trail', ClockCounterClockwise]];
  const endpoint = {
    connections: 'integrations',
    people: 'users',
    rates: 'rates',
    usage: 'usage',
    audit: 'audit'
  };
  const data = cache[tab] || [];
  function setData(rows) {
    setCache(c => ({
      ...c,
      [tab]: rows
    }));
  }
  async function load() {
    if(tab==='brand')return;
    try {
      if (tab === 'structure') setData(units);else setData(await api(tab === 'templates' ? '/templates' : '/admin/' + endpoint[tab]));
    } catch (e) {
      notify(e.message);
    }
  }
  useEffect(() => {
    setData([]);
    load();
  }, [tab, units]);
  async function sync() {
    setBusy(true);
    try {
      const r = await api('/admin/sync-directory', {
        method: 'POST'
      });
      notify(`Directory sync complete: ${r.imported} users read; ${r.disabled} removed users disabled.`);
      await load();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <section className='full-page admin-page'>
<header className='page-header'>
<span className='eyebrow'>COMPANY WORKSPACE</span>
<h1>Administration</h1>
<p>Keep your people, providers and meeting standards in sync.</p>
</header>
<div className='admin-tabs'>{tabs.map(([id, label, Icon]) => <button key={id} className={id === tab ? 'active' : ''} onClick={() => setTab(id)}>
<Icon size={18} />{label}</button>)}</div>
{tab === 'brand' && <BrandSettings user={user} onSaved={onBrandSaved} notify={notify}/>}
{tab === 'connections' && <>
<div className='section-heading'>
<div>
<h2>Provider connections</h2>
<p className='muted'>Credentials stay encrypted on the server. Configuration does not imply a verified connection.</p>
</div>
</div>
<div className='connection-list'>{data.map(c => <article className='connection-row' key={c.provider}>
<div className='provider-icon'>{c.provider === 'Microsoft 365' ? <Buildings /> : c.provider === 'ElevenLabs' ? <Waveform /> : c.provider === 'Minutes AI' ? <NotePencil /> : <VideoCamera />}</div>
<div className='connection-info'>
<h3>{c.provider}</h3>
<p>{{
                'Microsoft 365': 'Company sign-in, directory sync and optional calendar access.',
                'ElevenLabs': 'Final transcription with voice labels and timestamps; Recall capture can instead use participant attribution.',
                'Minutes AI': 'Evidence-linked drafts using an OpenAI-compatible endpoint.',
                'Teams': 'Choose Recall.ai or your own Azure Windows media worker.',
                'Zoom': 'Choose a Recall.ai participant bot or a direct Zoom RTMS receiver.'
              }[c.provider]}</p>
<span className={'connection-status ' + (c.status === 'CONNECTED' ? 'connected' : '')}>{c.status.replaceAll('_', ' ').toLowerCase()}{c.has_secret ? ' · credential saved' : ''}</span>
 {['Teams','Zoom'].includes(c.provider)&&<small className='capture-method-label'>Selected: {c.config.captureMethod==='direct'?'Direct integration':'Recall.ai'}</small>}
</div>
<Button onClick={() => setModal({
            kind: ['Teams','Zoom'].includes(c.provider)?'capture':'connection',
            value: c
          })}>{['Teams', 'Zoom'].includes(c.provider) ? 'Configure & setup guide' : 'Configure'}</Button>
</article>)}</div>
<div className='notice neutral'>
<ShieldCheck size={22} />
<span>Each platform has two capture methods. Complete the selected method’s checks before assigning capture. Connection, host authorisation and active recording are shown separately.</span>
</div>
</>}
{tab === 'people' && <>
<div className='section-heading'>
<div>
<h2>People & access</h2>
<p className='muted'>Removed Microsoft users are disabled and retained with their history.</p>
</div>
<div className='button-row'>
<Button icon={ArrowClockwise} onClick={sync} disabled={busy}>Sync Microsoft 365</Button>
<Button primary icon={Plus} onClick={() => setModal({
            kind: 'user'
          })}>Add user</Button>
</div>
</div>
<div className='table-wrap'>
<table>
<thead>
<tr>
<th>Person</th>
<th>Roles</th>
<th>Access scope</th>
<th>Status</th>
<th />
</tr>
</thead>
<tbody>{data.map(u => <tr key={u.id}>
<td>
<strong>{u.name}</strong>
<small>{u.email}</small>
</td>
<td>{u.roles.map(r => <span className='role-tag' key={r}>{r.replaceAll('_', ' ').toLowerCase()}</span>)}</td>
<td>{u.unit_ids.map(id => units.find(u => u.id === id)?.name).filter(Boolean).join(', ') || 'Own meetings only'}</td>
<td>{u.active ? 'Active' : u.removed_at ? 'Removed in Microsoft 365' : 'Disabled'}</td>
<td>
<button className='text-button' onClick={() => u.id === user.id ? onMyAccount() : setModal({
                  kind: 'user',
                  value: u
                })}>{u.id === user.id ? 'My account' : 'Manage'}</button>
</td>
</tr>)}</tbody>
</table>
</div>
</>}
{tab === 'structure' && <>
<div className='section-heading'>
<div>
<h2>{user.organization}</h2>
<p className='muted'>Company → Department → Team. Access is explicitly granted to each scope.</p>
</div>
<Button primary icon={Plus} onClick={() => setModal({
          kind: 'unit'
        })}>Add department or team</Button>
</div>
<div className='org-tree'>{units.filter(u => u.kind === 'department').map(d => <section key={d.id}>
<h3>
<Buildings size={21} />{d.name}<span>Department</span>
</h3>{units.filter(t => t.parent_id === d.id).map(t => <div key={t.id}>
<UsersThree size={21} />{t.name}<span>Team</span>
</div>)}</section>)}</div>
<div className='notice neutral'>Department membership does not automatically grant access to child teams. Assign the required teams explicitly.</div>
</>}
{tab === 'templates' && <>
<div className='section-heading'>
<div>
<h2>Minutes templates</h2>
<p className='muted'>Published versions are immutable. Existing minutes keep their original template.</p>
</div>
<Button primary icon={Plus} onClick={() => setModal({
          kind: 'template'
        })}>Publish template</Button>
</div>{data.map(t => <article className='template-row' key={t.id}>
<BookOpen size={28} />
<div>
<h3>{t.name} <span className='role-tag'>v{t.version}</span>
</h3>
<p>{t.language} · {t.sections.join(' · ')}</p>
<p className='small muted'>{t.docx_name?`Word layout: ${t.docx_name} · DOCX and PDF`:'Standard layout'}</p>
</div>
<Button onClick={() => setModal({
          kind: 'template',
          value: t
        })}>Create new version</Button>
</article>)}</>}
{tab === 'rates' && <>
<div className='section-heading'>
<div>
<h2>API rates & exchange rates</h2>
<p className='muted'>Enter contracted rates. Every usage entry keeps its applicable price and USD/HKD rate.</p>
</div>
<Button primary icon={Plus} onClick={() => setModal({
          kind: 'rate'
        })}>Add rate</Button>
</div>
<div className='notice warm'>Calculated costs are not invoice-reconciled. Taxes, minimum charges and discounts are not automatically included.</div>
<div className='table-wrap'>
<table>
<thead>
<tr>
<th>Provider / model</th>
<th>Billing unit</th>
<th>USD / unit</th>
<th>HKD / USD</th>
<th>Effective from</th>
</tr>
</thead>
<tbody>{data.map(r => <tr key={r.id}>
<td>
<strong>{r.provider}</strong>
<small>{r.model}</small>
</td>
<td>{r.unit.replaceAll('_', ' ')}</td>
<td>${Number(r.usd_rate).toFixed(6)}</td>
<td>{Number(r.hkd_per_usd).toFixed(4)}</td>
<td>{formatDate(r.effective_at, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric'
                })}</td>
</tr>)}</tbody>
</table>
</div>{!data.length && <Empty title='Your rates, your costs' text='Add audio-minute and token rates to calculate spending for future usage.' />}</>}
{tab === 'usage' && <>
<div className='section-heading'>
<h2>Provider usage ledger</h2>
</div>
<div className='table-wrap'>
<table>
<thead>
<tr>
<th>Meeting</th>
<th>Provider / model</th>
<th>Quantity</th>
<th>USD</th>
<th>HKD</th>
<th>Basis</th>
</tr>
</thead>
<tbody>{data.map(u => <tr key={u.id}>
<td>{u.title}</td>
<td>{u.provider}<small>{u.model}</small>
</td>
<td>{Number(u.quantity).toFixed(4)}<small>{u.unit.replaceAll('_', ' ')}</small>
</td>
<td>{u.usd === null ? 'Missing rate' : Number(u.usd).toFixed(4)}</td>
<td>{u.hkd === null ? '—' : Number(u.hkd).toFixed(4)}</td>
<td>{u.status}</td>
</tr>)}</tbody>
</table>
</div>{!data.length && <Empty title='No provider usage yet' text='Usage appears after a transcription or generation request completes.' />}</>}
{tab === 'audit' && <>
<div className='section-heading'>
<h2>Audit trail</h2>
<Button icon={ArrowClockwise} onClick={load}>Refresh</Button>
</div>
<div className='table-wrap'>
<table>
<thead>
<tr>
<th>When</th>
<th>Actor</th>
<th>Event</th>
<th>Details</th>
</tr>
</thead>
<tbody>{data.map(a => <tr key={a.id}>
<td>{formatDate(a.created_at, {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit'
                })}</td>
<td>{a.actor || 'System'}</td>
<td>{a.action}</td>
<td>
<details>
<summary>View change</summary>
<pre>{JSON.stringify(a.detail, null, 2)}</pre>
</details>
</td>
</tr>)}</tbody>
</table>
</div>{!data.length && <Empty title='No changes recorded yet' text='Configuration, access, review and export events appear here.' />}</>}
{modal?.kind==='template' && <TemplateDialog value={modal.value} onClose={()=>setModal(null)} notify={notify} onSaved={async()=>{setModal(null);await load();await refresh()}}/>}
{modal?.kind==='capture' && <CaptureSetup platform={modal.value.provider} onClose={()=>setModal(null)} notify={notify} onSaved={async()=>{await load();await refresh();}}/>}
{modal && !['template','capture'].includes(modal.kind) && <AdminDialog modal={modal} units={units} onClose={() => setModal(null)} notify={notify} onSaved={async () => {
      setModal(null);
      await load();
      await refresh();
    }} />}</section>;
}
function AdminDialog({
  modal,
  units,
  onClose,
  onSaved,
  notify
}) {
  const {
    kind,
    value: v
  } = modal;
  const [busy, setBusy] = useState(false),
    [roles, setRoles] = useState(v?.roles || ['MEMBER']),
    [scopes, setScopes] = useState(v?.unit_ids || []);
  const title = {
    connection: `${v?.provider} connection`,
    user: v ? 'Manage access' : 'Add local user',
    unit: 'Add department or team',
    template: v ? 'Publish a new template version' : 'Publish minutes template',
    rate: 'Add an API rate'
  }[kind];
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (kind === 'connection') await api('/admin/integrations', {
        method: 'PUT',
        body: {
          provider: v.provider,
          config: {
            ...(f.tenantId ? {
              tenantId: f.tenantId,
              clientId: f.clientId
            } : {}),
            ...(f.model ? {
              model: f.model
            } : {}),
            ...(f.baseUrl ? {
              baseUrl: f.baseUrl
            } : {})
          },
          secret: f.secret || undefined
        }
      });
      if (kind === 'user') await api('/admin/users' + (v ? '/' + v.id : ''), {
        method: v ? 'PATCH' : 'POST',
        body: v ? {
          active: f.active === 'on',
          roles,
          unitIds: scopes
        } : {
          name: f.name,
          email: f.email,
          password: f.password,
          roles,
          unitIds: scopes
        }
      });
      if (kind === 'unit') await api('/admin/units', {
        method: 'POST',
        body: {
          name: f.name,
          kind: f.kind,
          parentId: f.kind === 'team' ? f.parentId : null
        }
      });
      if (kind === 'template') await api('/templates', {
        method: 'POST',
        body: {
          name: f.name,
          language: f.language,
          sections: f.sections.split('\n').map(s => s.trim()).filter(Boolean)
        }
      });
      if (kind === 'rate') await api('/admin/rates', {
        method: 'POST',
        body: {
          provider: f.provider,
          model: f.model,
          unit: f.unit,
          usdRate: Number(f.usdRate),
          hkdPerUsd: Number(f.hkdPerUsd),
          effectiveAt: new Date(f.effectiveAt + '+08:00').toISOString()
        }
      });
      notify('Saved successfully.');
      onSaved();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <Modal title={title} onClose={onClose}>
<form onSubmit={submit}>
{kind === 'connection' && (['Teams', 'Zoom'].includes(v.provider) ? <>
<div className='notice warm'>Capture adapter not installed. Assignments can be saved, but no agent will join or record.</div>
<p>{v.provider === 'Teams' ? 'Teams capture needs an Azure Windows media worker, a calling bot, application permissions and tenant administrator consent.' : 'Zoom capture needs an approved RTMS application or participant agent, account entitlements and authenticated media callbacks.'}</p>
<p>See the provider setup guide for deployment dependencies.</p>
</> : <>
<p className='muted'>Saved credentials are never returned to the browser.</p>{v.provider === 'Microsoft 365' && <>
<Field label='Microsoft tenant ID'>
<input name='tenantId' required defaultValue={v.config?.tenantId} />
</Field>
<Field label='Application client ID'>
<input name='clientId' required defaultValue={v.config?.clientId} />
</Field>
<div className='notice neutral'>Web redirect URI: <code>{location.origin}/api/auth/microsoft-callback</code>
<br />Directory sync: User.Read.All application permission. Calendar: Calendars.Read application permission. Both require admin consent and appropriate mailbox restrictions.</div>
</>}{v.provider === 'Minutes AI' && <Field label='OpenAI-compatible API base URL' hint='Local gateway: http://localhost:20128/v1. Docker routes this to your host computer. Use an API key and model ID from the same gateway.'>
<input name='baseUrl' type='url' required defaultValue={v.config?.baseUrl || 'https://api.openai.com/v1'} />
</Field>}{v.provider !== 'Microsoft 365' && <Field label='Model ID'>
<input name='model' required defaultValue={v.config?.model || (v.provider === 'ElevenLabs' ? 'scribe_v2' : '')} placeholder='Provider model ID' />
</Field>}<Field label={v.provider === 'Microsoft 365' ? 'Client secret' : 'API key'} hint={v.has_secret ? 'Leave blank to retain the credential.' : 'Encrypted at rest with the installation key.'}>
<input name='secret' type='password' autoComplete='new-password' required={!v.has_secret} placeholder={v.has_secret ? 'Credential already saved' : ''} />
</Field>
</>)}
{kind === 'user' && <>{!v && <>
<Field label='Full name'>
<input name='name' required minLength={2} />
</Field>
<Field label='Email'>
<input name='email' type='email' required />
</Field>
<Field label='Initial password' hint={passwordHint + ' Share securely.'}>
<input name='password' type='password' required {...newPasswordProps} />
</Field>
</>}{v && <>
<p>
<strong>{v.name}</strong>
<br />{v.email}</p>
<label className='checkbox'>
<input type='checkbox' name='active' defaultChecked={v.active} />Account enabled</label>
</>}<fieldset>
<legend>Roles</legend>{['ORG_ADMIN', 'MEETING_ORGANIZER', 'REVIEWER', 'APPROVER', 'MEMBER'].map(role => <label className='checkbox' key={role}>
<input type='checkbox' checked={roles.includes(role)} onChange={e => setRoles(e.target.checked ? [...roles, role] : roles.filter(r => r !== role))} />{role.replaceAll('_', ' ').toLowerCase()}</label>)}</fieldset>
<fieldset>
<legend>Authorised departments and teams</legend>{units.map(u => <label className='checkbox' key={u.id}>
<input type='checkbox' checked={scopes.includes(u.id)} onChange={e => setScopes(e.target.checked ? [...scopes, u.id] : scopes.filter(id => id !== u.id))} />{u.name} · {u.kind}</label>)}</fieldset>
</>}
{kind === 'unit' && <>
<Field label='Name'>
<input name='name' required minLength={2} />
</Field>
<Field label='Type'>
<select name='kind'>
<option value='team'>Team</option>
<option value='department'>Department</option>
</select>
</Field>
<Field label='Parent department (for teams)'>
<select name='parentId'>{units.filter(u => u.kind === 'department').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
</Field>
</>}
{kind === 'template' && <>
<Field label='Template name'>
<input name='name' required minLength={2} defaultValue={v?.name} />
</Field>
<Field label='Output language'>
<select name='language' defaultValue={v?.language || 'English'}>{['English', 'Traditional Chinese', 'Simplified Chinese', 'Bilingual English / Traditional Chinese'].map(l => <option key={l}>{l}</option>)}</select>
</Field>
<Field label='Section headings (one per line)'>
<textarea name='sections' required rows={6} defaultValue={(v?.sections || ['Progress update', 'Decisions', 'Actions', 'Open questions', 'Next meeting']).join('\n')} />
</Field>
<p className='small muted'>These headings guide AI generation. Exports currently use the standard evidence-linked minutes structure.</p>
</>}
{kind === 'rate' && <>
<Field label='Provider'>
<select name='provider'>
<option>ElevenLabs</option>
<option>Minutes AI</option>
<option>Recall.ai</option>
</select>
</Field>
<Field label='Exact model ID'>
<input name='model' required placeholder='Must match the configured model' />
</Field>
<Field label='Billing unit'>
<select name='unit'>
<option value='audio_minute'>Audio minute</option>
<option value='bot_minute'>Recall bot active minute</option>
<option value='input_million_tokens'>1 million input tokens</option>
<option value='output_million_tokens'>1 million output tokens</option>
</select>
</Field>
<div className='form-grid'>
<Field label='USD per billing unit'>
<input name='usdRate' type='number' step='0.00000001' min='0' required />
</Field>
<Field label='HKD per USD'>
<input name='hkdPerUsd' type='number' step='0.00000001' min='0.00000001' required placeholder='Your accounting rate' />
</Field>
</div>
<Field label='Effective from (Hong Kong time)'>
<input name='effectiveAt' type='datetime-local' required defaultValue={localInput()} />
</Field>
<p className='small muted'>Changes apply to future usage. Existing cost snapshots are preserved.</p>
</>}
<footer className='modal-actions'>
<Button type='button' onClick={onClose}>Close</Button>{!(kind === 'connection' && ['Teams', 'Zoom'].includes(v.provider)) && <Button primary disabled={busy}>{busy ? 'Saving…' : kind === 'template' ? 'Publish version' : 'Save'}</Button>}</footer>
</form>
</Modal>;
}
