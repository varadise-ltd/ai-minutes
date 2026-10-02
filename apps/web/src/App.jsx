import React, { useEffect, useRef, useState } from 'react';
import { CalendarBlank, FileText, CheckCircle, CaretRight, CaretLeft, LinkSimple, UploadSimple, GearSix, SignOut, Plus, X, Buildings, ShieldCheck, ArrowRight, MagnifyingGlass, WarningCircle, ArrowClockwise, NotePencil, Microphone, Waveform, List, Clock } from '@phosphor-icons/react';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import { api, labels, time, dateKey, formatDate, localInput, allowed } from './api';
import { Status, Platform, Empty, Button, Modal, Field } from './ui';
import { Review } from './Review';
import { Admin } from './Admin';
import { Account } from './Account';
import { newPasswordProps, passwordHint } from './passwordPolicy';
import { Recorder } from './Recorder';
import { BrandMark } from './Brand';
import { applyBrand, defaultBrand } from './brand';
function Login({
  onLogin,
  notify
}) {
  const [config, setConfig] = useState(null),
    [mode, setMode] = useState('login'),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/auth/config').then(c => {
      setConfig(c);
      applyBrand(c.brand);
      setMode(c.setupRequired ? 'setup' : 'login');
    }).catch(e => notify(e.message));
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/auth/' + mode, {
        method: 'POST',
        body: Object.fromEntries(new FormData(e.currentTarget))
      });
      onLogin();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <main className='login-page'>
<aside className='login-story'>
<BrandMark config={config?.brand}/>
<div>
<span className='eyebrow'>{config?.brand?.tagline ?? defaultBrand.tagline}</span>
<h1>From conversation<br />to shared understanding.</h1>
<p>Capture your meetings. Review the evidence.<br />Put clear, approved minutes in everyone’s hands.</p>
<div className='login-steps'>
<span>
<CalendarBlank />Plan & capture</span>
<span>
<NotePencil />Review together</span>
<span>
<ShieldCheck />Approve & share</span>
</div>
</div>
<small>Company, department and team access · Human approval by design</small>
</aside>
<section className='login-form'>
<div className='login-inner'>
<span className='eyebrow'>YOUR MEETING WORKSPACE</span>
<h2>{mode === 'setup' ? 'Set up your company' : 'Welcome back'}</h2>
<p className='muted'>{mode === 'setup' ? 'Create the first administrator account for this installation.' : 'Sign in to your company’s meeting workspace.'}</p>{config ? <>
<form onSubmit={submit}>{mode === 'setup' && <>
<Field label='Company name'>
<input name='company' required minLength={2} placeholder='Your company' />
</Field>
<Field label='Your name'>
<input name='name' required minLength={2} placeholder='Full name' />
</Field>
</>}<Field label='Work email'>
<input name='email' type='email' required autoComplete='username' placeholder='you@company.com' />
</Field>
<Field label='Password' hint={mode === 'setup' ? passwordHint : null}>
<input name='password' type='password' required {...(mode === 'setup' ? newPasswordProps : { minLength: 1, maxLength: 200, autoComplete: 'current-password' })} />
</Field>
<Button primary disabled={busy} icon={ArrowRight}>{busy ? 'Please wait…' : mode === 'setup' ? 'Create company workspace' : 'Sign in'}</Button>
</form>{config.microsoft.map(o => <a className='button microsoft-button' href={'/api/auth/microsoft/' + o.id} key={o.id}>
<Buildings size={20} />Sign in with Microsoft · {o.name}</a>)}{config.demoEnabled && <div className='demo-entry'>
<span>Want to explore first?</span>
<Button onClick={async () => {
              try {
                await api('/auth/demo', {
                  method: 'POST'
                });
                onLogin();
              } catch (e) {
                notify(e.message);
              }
            }}>Open sample workspace <ArrowRight />
</Button>
<small>Sample meetings only. External services are disconnected.</small>
</div>}</> : <p>Connecting to your workspace…</p>}</div>
</section>
</main>;
}
export function App() {
  const [brand,setBrand]=useState(null);
  useEffect(()=>{applyBrand(brand);},[brand]);
  const [user, setUser] = useState(null),
    [units, setUnits] = useState([]),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState('today'),
    [meetings, setMeetings] = useState([]),
    [selected, setSelected] = useState(null),
    [detail, setDetail] = useState(null),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(''),
    [link, setLink] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [team, setTeam] = useState('all'),
    [mobileNav, setMobileNav] = useState(false);
  const toastTimer = useRef();
  function notify(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 7000);
  }
  async function load() {
    try {
      const me = await api('/me');
      setUser(me.user);
      setUnits(me.units);
      const appearance=await api('/brand');
      setBrand(appearance.config);
      const list = await api('/meetings');
      setMeetings(list);
      setSelected(s => s || list.find(m => m.status === 'WAITING_FOR_ADMISSION')?.id || list[0]?.id);
    } catch (e) {
      if (e.status === 401) setUser(null);else notify(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!selected || !user) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    api('/meetings/' + selected).then(d => {
      if (!cancelled) setDetail(d);
    }).catch(e => notify(e.message));
    return () => {
      cancelled = true;
    };
  }, [selected, user]);
  async function refresh() {
    await load();
    if (selected) setDetail(await api('/meetings/' + selected));
  }
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => {
      api('/meetings').then(setMeetings).catch(() => {});
    }, 15000);
    return () => clearInterval(t);
  }, [user]);
  useEffect(() => {
    if (!selected || !['SCHEDULED','JOINING_CALL','WAITING_FOR_HOST','WAITING_FOR_ADMISSION','IN_CALL_NOT_RECORDING','CAPTURING','STOPPING_CAPTURE','PROCESSING_RECORDING','TRANSCRIBING_FINAL','GENERATING_MINUTES'].includes(detail?.status)) return;
    let cancelled = false;
    const timer = setInterval(() => {
      api('/meetings/' + selected).then(d => {
        if (!cancelled) setDetail(d);
      }).catch(() => {});
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selected, detail?.status]);
  function navigate(p) {
    setPage(p);
    setSearch('');
    setFilter('all');
    setMobileNav(false);
  }
  function openMeeting(m, review = false) {
    if (m.id !== selected) setDetail(null);
    setSelected(m.id);
    if (review) setPage('review');
  }
  async function action(action, reason) {
    try {
      await api(`/meetings/${detail.id}/actions/${action}`, {
        method: 'POST',
        body: {
          revision: detail.revision,
          reason
        }
      });
      await refresh();
      notify({
        cancel: 'Meeting cancelled.',
        submit: 'Submitted for approval.',
        approve: 'Minutes approved. This version is now locked.',
        reopen: 'A new draft version is ready.',
        reject: 'Returned to the reviewer.'
      }[action]);
    } catch (e) {
      notify(e.message);
    }
  }
  const visible = meetings.filter(m => (team === 'all' || m.unit_id === team) && m.title.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || m.status === filter));
  const todays = visible.filter(m => dateKey(m.scheduled_at) === dateKey(new Date())),
    reviewCount = meetings.filter(m => ['READY_FOR_REVIEW', 'REJECTED'].includes(m.status)).length;
  const toastEl = toast && <div className='toast' role='status'>
<WarningCircle size={19} />
<span>{toast}</span>
<button aria-label='Dismiss notification' onClick={() => setToast('')}>
<X />
</button>
</div>;
  if (loading) return <div className='loading'>
<Waveform size={38} />
<p>Opening your meeting workspace…</p>
</div>;
  if (!user) return <>
<Login onLogin={load} notify={notify} />{toastEl}</>;
  const nav = [['today', 'Today', CalendarBlank], ['calendar', 'Calendar', CalendarBlank], ['minutes', 'Minutes', FileText], ['reviews', 'Reviews', CheckCircle]];
  const panel = <DetailPanel detail={detail} onReview={() => {
    setModal(null);
    setPage('review');
  }} onEdit={() => setModal({
    type: 'meeting',
    meeting: detail
  })} onUpload={() => setModal({
    type: 'upload',
    meeting: detail
  })} action={action} user={user} />;
  return <div className='app-shell'>
<button className='mobile-menu icon-button' aria-label='Open navigation' onClick={() => setMobileNav(!mobileNav)}>
<List size={24} />
</button>
<aside className={'sidebar ' + (mobileNav ? 'mobile-open' : '')}>
<BrandMark config={brand}/>
<div className='org-name'>{user.organization}</div>
<div className='org-scope'>{units.find(u => u.kind === 'department')?.name || 'Company workspace'}</div>
<nav>{nav.map(([id, label, Icon]) => <button key={id} className={page === id || page === 'review' && id === 'reviews' ? 'active' : ''} onClick={() => navigate(id)}>
<Icon size={23} weight={page === id ? 'duotone' : 'regular'} />{label}{id === 'reviews' && reviewCount > 0 && <span className='nav-count'>{reviewCount}</span>}</button>)}</nav>
<div className='sidebar-bottom'>{allowed(user, 'ORG_ADMIN') && <button className={page === 'admin' ? 'active' : ''} onClick={() => navigate('admin')}>
<GearSix size={23} />Administration</button>}
<button className={page === 'account' ? 'active' : ''} onClick={() => navigate('account')}><ShieldCheck size={23} />My account</button><div className='profile'>
<div className='avatar'>{user.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</div>
<button className='profile-identity' aria-label='Open my profile' onClick={() => navigate('account')}>
<strong>{user.name}</strong>
<small>{user.roles.includes('ORG_ADMIN') ? 'Administrator' : 'Team member'}</small>
</button>
<button className='icon-button' aria-label='Sign out' onClick={async () => {
            await api('/auth/logout', {
              method: 'POST'
            });
            setUser(null);
            setBrand(null);
            setSelected(null);
          }}>
<SignOut size={19} />
</button>
</div>
</div>
</aside>
<main className={'workspace ' + (page === 'review' ? 'review-page' : '')}>
{user.demo && <div className='demo-banner'>
<span>
<span className='demo-dot' />Sample workspace · Test audio only · No external API calls</span>
<button onClick={async () => {
          await api('/auth/logout', {
            method: 'POST'
          });
          setUser(null);
          setSelected(null);
        }}>Set up your company <ArrowRight size={15} />
</button>
</div>}
{['today', 'minutes'].includes(page) && allowed(user, 'MEETING_ORGANIZER') && <div className='capture-entry'>
<div>
<strong>Meeting in the room?</strong>
<p>Record with your phone or computer microphone.</p>
</div>
<Button primary icon={Microphone} onClick={() => setModal({
          type: 'meeting',
          upload: true,
          record: true
        })}>Record a meeting</Button>
</div>}
{page === 'today' && <>
<div className='desk-layout'>
<section className='desk-main'>
<header className='page-header'>
<h1>Your meeting desk</h1>
<p>{formatDate(new Date(), {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long'
                })} <span className='separator'>·</span> Hong Kong</p>
</header>
<section className='quick-add'>
<h2>Add a minutes taker to a meeting</h2>
<div className='link-form'>
<div className='input-icon'>
<LinkSimple size={23} />
<input aria-label='Meeting link' placeholder='Paste a Teams or Zoom meeting link' value={link} onChange={e => setLink(e.target.value)} />
</div>
<Button primary disabled={!allowed(user, 'MEETING_ORGANIZER')} onClick={() => setModal({
                  type: 'meeting',
                  link
                })}>Set up minutes taker</Button>
</div>
<div className='quick-links'>
<button onClick={() => setModal({
                  type: 'meeting'
                })}>
<CalendarBlank size={20} />Schedule for later</button>
<span />
<button onClick={() => setModal({
                  type: 'meeting',
                  upload: true
                })}>
<UploadSimple size={20} />Upload a recording</button>
</div>
</section>
<div className='section-heading'>
<h2>Today</h2>
<label className='inline-filter'>Team<select value={team} onChange={e => setTeam(e.target.value)}>
<option value='all'>All authorised teams</option>{units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
</label>
</div>
<MeetingList meetings={todays} selected={selected} onSelect={m => openMeeting(m)} compact />{!todays.length && <Empty title='A little room in your day' text='Schedule a meeting or upload a recording to get started.' />}</section>{panel}</div>
<footer className='desk-footer'>
<span>
<FileText size={23} />{reviewCount} {reviewCount === 1 ? 'draft needs' : 'drafts need'} your review</span>
<button onClick={() => navigate('reviews')}>Open review queue <ArrowRight size={20} />
</button>
</footer>
</>}
{page === 'calendar' && <Calendar meetings={visible} onSelect={m => {
        openMeeting(m);
        setModal({
          type: 'detail'
        });
      }} onCreate={() => setModal({
        type: 'meeting'
      })} notify={notify} onImport={event => setModal({
        type: 'meeting',
        event
      })} />}
{['minutes', 'reviews'].includes(page) && <section className='full-page'>
<header className='page-header header-actions'>
<div>
<span className='eyebrow'>{page === 'reviews' ? 'REVIEW & APPROVAL' : 'YOUR MEETING LIBRARY'}</span>
<h1>{page === 'reviews' ? 'Ready for a closer look' : 'Meeting minutes'}</h1>
<p>{page === 'reviews' ? 'Check the evidence, resolve uncertainties, and approve with confidence.' : 'Find the conversation. Keep the decisions.'}</p>
</div>
<Button primary icon={Plus} onClick={() => setModal({
            type: 'meeting',
            upload: true
          })}>Upload recording</Button>
</header>
<div className='filterbar'>
<div className='input-icon'>
<MagnifyingGlass size={20} />
<input aria-label='Search meetings' placeholder='Search meetings…' value={search} onChange={e => setSearch(e.target.value)} />
</div>
<select aria-label='Filter status' value={filter} onChange={e => setFilter(e.target.value)}>
<option value='all'>All statuses</option>{Object.entries(labels).map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>
</div>
<MeetingList meetings={visible.filter(m => page !== 'reviews' || ['READY_FOR_REVIEW', 'IN_REVIEW', 'REJECTED'].includes(m.status))} selected={selected} onSelect={m => openMeeting(m, true)} />{!visible.filter(m => page !== 'reviews' || ['READY_FOR_REVIEW', 'IN_REVIEW', 'REJECTED'].includes(m.status)).length && <Empty title={page === 'reviews' ? 'You’re all caught up' : 'No meetings found'} text='Try another filter or add your first meeting.' />}</section>}
{page === 'review' && (detail ? <Review key={detail.id} detail={detail} user={user} refresh={refresh} notify={notify} action={action} onUpload={() => setModal({
        type: 'upload',
        meeting: detail
      })} onRecord={() => setModal({
        type: 'record',
        meeting: detail
      })} /> : <Empty title='Choose a meeting to review'>
<Button onClick={() => navigate('minutes')}>Open minutes</Button>
</Empty>)}
{page === 'admin' && <Admin user={user} units={units} refresh={refresh} notify={notify} onBrandSaved={setBrand} onMyAccount={() => navigate('account')} />}
{page === 'account' && <Account user={user} units={units} onProfileSaved={saved => setUser(current => ({ ...current, ...saved }))} onPasswordChanged={() => {
  setUser(null); setBrand(null); setSelected(null); setPage('today');
  notify('Password changed. Sign in again with your new password.');
}} />}</main>
{modal?.type === 'meeting' && <MeetingForm initial={modal} units={units} onClose={() => setModal(null)} notify={notify} onSaved={async (id, file) => {
      const record = modal.record;
      setModal(null);
      setLink('');
      setSelected(id);
      const meeting = await api('/meetings/' + id);
      setDetail(meeting);
      await load();
      if (file) {
        setPage('review');
        setModal({
          type: record ? 'record' : 'upload',
          meeting
        });
      } else setPage('minutes');
    }} />}
{modal?.type === 'upload' && <UploadDialog meeting={modal.meeting} onClose={() => setModal(null)} onSaved={async () => {
      setModal(null);
      await refresh();
      setPage('review');
    }} notify={notify} />}
{modal?.type === 'record' && <Recorder key={modal.meeting.id} user={user} meeting={modal.meeting} onClose={() => setModal(null)} onSaved={async () => {
      setModal(null);
      await refresh();
      setPage('review');
    }} notify={notify} />}
{modal?.type === 'detail' && <Modal title='Meeting details' onClose={() => setModal(null)}>{panel}</Modal>}{toastEl}</div>;
}
function MeetingList({
  meetings,
  selected,
  onSelect,
  compact
}) {
  return <div className={'meeting-list ' + (compact ? 'compact' : '')}>
<div className='list-head'>
<span>{compact ? 'Time' : 'Date & time'}</span>
<span>Meeting</span>
<span>Platform</span>
<span>Status</span>
<span />
</div>{meetings.map(m => <button key={m.id} className={'meeting-row ' + (m.id === selected ? 'selected' : '')} onClick={() => onSelect(m)}>
<div className='meeting-time'>{!compact && <small>{formatDate(m.scheduled_at, {
            day: '2-digit',
            month: 'short'
          })}</small>}{time(m.scheduled_at)}</div>
<div className='meeting-title'>
<strong>{m.title}</strong>
<small>{m.unit_name || 'Company'}{m.reference_number ? ` · ${m.reference_number}` : ''}{m.sample ? ' · Sample' : ''}</small>
</div>
<Platform value={m.platform} />
<Status value={m.status} />
<CaretRight size={19} />
</button>)}</div>;
}
function DetailPanel({
  detail: m,
  onReview,
  onEdit,
  onUpload,
  action,
  user
}) {
  if (!m) return <aside className='detail-pane'>
<Empty title='Your meeting, at a glance' text='Select a meeting to see its capture status and next step.' />
</aside>;
  const hasDoc = m.minutes?.length > 0;
  return <aside className='detail-pane'>
<h2>{m.title}</h2>
<p className='muted'>{formatDate(m.scheduled_at, {
        day: 'numeric',
        month: 'short'
      })} · {time(m.scheduled_at)} HKT{m.reference_number ? ` · ${m.reference_number}` : ''}</p>
<Status value={m.status} />{m.sample && <small className='sample-note'>Sample meeting · Status is illustrative</small>}{m.status === 'WAITING_FOR_ADMISSION' && <>
<div className='notice warm'>The host needs to admit AI Minutes.<br />Recording has not started.</div>
<div className='lifecycle'>
<div className='done'>
<CheckCircle weight='fill' />Assignment created</div>
<div className='done'>
<CheckCircle weight='fill' />Join requested</div>
<div className='current'>
<Clock weight='fill' />
<strong>Waiting for admission</strong>
</div>
<div>
<Microphone />Capturing</div>
</div>
</>}{m.error && <div className='notice warm'>
<WarningCircle size={20} />
<span>{m.error}</span>
</div>}{hasDoc && <div className='notice green'>Your transcript and draft minutes are ready. Review the source evidence before approval.</div>}<div className='detail-buttons'>{hasDoc ? <Button primary icon={NotePencil} onClick={onReview}>Open review workspace</Button> : <Button icon={FileText} onClick={onReview}>Open meeting workspace</Button>}{['DRAFT', 'SETUP_REQUIRED', 'SCHEDULED'].includes(m.status) && <Button icon={CalendarBlank} onClick={onEdit}>Edit assignment</Button>}{['DRAFT', 'SETUP_REQUIRED'].includes(m.status) && <Button icon={UploadSimple} onClick={onUpload}>Upload recording</Button>}{['DRAFT', 'SETUP_REQUIRED', 'SCHEDULED', 'WAITING_FOR_ADMISSION'].includes(m.status) && allowed(user, 'MEETING_ORGANIZER') && <Button onClick={() => action('cancel')}>{m.status === 'WAITING_FOR_ADMISSION' ? 'Cancel join request' : 'Cancel meeting'}</Button>}</div>
<div className='detail-after'>
<h3>After the meeting</h3>
<p>Review the transcript and draft minutes, then submit for approval.</p>
<div className='detail-fact'>
<ShieldCheck size={20} />
<span>Only authorised team members can access this meeting.</span>
</div>
</div>
</aside>;
}
function MeetingForm({
  initial,
  units,
  onClose,
  onSaved,
  notify
}) {
  const [templates, setTemplates] = useState([]),
    [reviewers, setReviewers] = useState([]),
    [busy, setBusy] = useState(false);
  const m = initial.meeting;
  useEffect(() => {
    Promise.all([api('/templates'), api('/reviewers')]).then(([t, r]) => {
      setTemplates(t);
      setReviewers(r);
    }).catch(e => notify(e.message));
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const body = {
      title: data.title,
      referenceNumber: data.referenceNumber.trim(),
      joinUrl: data.joinUrl || '',
      scheduledAt: new Date(data.scheduledAt + '+08:00').toISOString(),
      timezone: 'Asia/Hong_Kong',
      durationMinutes: Number(data.durationMinutes),
      unitId: data.unitId,
      templateId: data.templateId,
      reviewerId: data.reviewerId || null,
      consent: data.consent === 'on',
      ...(m ? {
        revision: m.revision
      } : {})
    };
    try {
      const r = await api('/meetings' + (m ? '/' + m.id : ''), {
        method: m ? 'PATCH' : 'POST',
        body
      });
      notify(m ? 'Assignment updated.' : initial.record ? 'Meeting created. Start recording when you are ready.' : initial.upload ? 'Meeting created. Add your recording next.' : 'Assignment saved. Provider setup is required before capture.');
      onSaved(m?.id || r.id, initial.upload);
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <Modal title={m ? 'Edit meeting assignment' : initial.record ? 'Record a meeting' : initial.upload ? 'Upload a meeting recording' : 'Set up a minutes taker'} onClose={onClose}>
<form onSubmit={submit}>
<p className='form-intro'>{initial.record ? 'Choose the meeting details and who can access it. You will start the microphone on the next screen.' : 'Choose the meeting, access scope and output. Recordings require participant notice and authorisation.'}</p>
<Field label='Meeting title'>
<input name='title' required minLength={2} maxLength={200} placeholder='e.g. Weekly site progress review' defaultValue={m?.title || initial.event?.title} />
</Field><Field label='Meeting reference number' hint='Optional code shown in the minutes header.'>
<input name='referenceNumber' maxLength={80} placeholder='e.g. M003_2026' defaultValue={m?.reference_number || ''} />
</Field>{!initial.upload && m?.platform !== 'Upload' && <Field label='Teams or Zoom meeting link'>
<input name='joinUrl' type='url' required placeholder='https://teams.microsoft.com/…' defaultValue={m?.join_url || initial.link || initial.event?.joinUrl} />
</Field>}<div className='form-grid'>
<Field label='Meeting start (Hong Kong time)'>
<input name='scheduledAt' type='datetime-local' required defaultValue={localInput(m?.scheduled_at || (initial.event?.start?.dateTime ? initial.event.start.dateTime + 'Z' : new Date()))} />
</Field>
<Field label='Duration (minutes)'>
<input name='durationMinutes' type='number' min={5} max={1440} required defaultValue={m?.duration_minutes || 60} />
</Field>
</div>
<Field label='Department or team' hint='The selected scope determines access to the transcript and minutes.'>
<select name='unitId' required defaultValue={m?.unit_id || units.find(u => u.kind === 'team')?.id}>{units.map(u => <option key={u.id} value={u.id}>{u.kind === 'team' ? 'Team: ' : 'Department: '}{u.name}</option>)}</select>
</Field>
<div className='form-grid'>
<Field label='Minutes template'>
<select name='templateId' required defaultValue={m?.template_id}>{templates.map(t => <option key={t.id} value={t.id}>{t.name} · v{t.version}</option>)}</select>
</Field>
<Field label='Reviewer'>
<select name='reviewerId' defaultValue={m?.reviewer_id || ''}>
<option value=''>Assign later</option>{reviewers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
</Field>
</div>
<label className='checkbox consent'>
<input type='checkbox' name='consent' required defaultChecked={m?.consent} />
<span>I am authorised to capture or upload this meeting and will ensure participants receive the required recording notice.</span>
<small>When remote capture is ready, saving a Teams or Zoom assignment sends its link to the selected capture service. Direct Zoom uses an authorised RTMS app without a participant bot. Capture, hosting and AI charges may apply.</small>
</label>
<footer className='modal-actions'>
<Button type='button' onClick={onClose}>Cancel</Button>
<Button primary disabled={busy || !templates.length}>{busy ? 'Saving…' : m ? 'Save assignment' : initial.record ? 'Continue to recorder' : initial.upload ? 'Continue to upload' : 'Save assignment'}</Button>
</footer>
</form>
</Modal>;
}
function UploadDialog({
  meeting,
  onClose,
  onSaved,
  notify
}) {
  const [file, setFile] = useState(null),
    [busy, setBusy] = useState(false);
  async function upload(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set('file', file);
      await api(`/meetings/${meeting.id}/upload`, {
        method: 'POST',
        body: form
      });
      notify('Recording stored. Start transcription from the meeting workspace.');
      onSaved();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <Modal title='Upload recording' onClose={onClose}>
<form onSubmit={upload}>
<label className='upload-zone'>
<UploadSimple size={40} />
<strong>{file ? file.name : 'Choose a meeting recording'}</strong>
<span>MP3, MP4, M4A, WAV, WEBM, OGG or FLAC · Up to 250 MB</span>
<input type='file' aria-label='Meeting recording' required accept='.mp3,.mp4,.m4a,.wav,.webm,.ogg,.flac' onChange={e => setFile(e.target.files[0])} />
</label>
<p className='muted small'>Uploading stores the file privately. Transcription is a separate action and may incur provider charges.</p>
<footer className='modal-actions'>
<Button type='button' onClick={onClose}>Cancel</Button>
<Button primary icon={UploadSimple} disabled={busy || !file}>{busy ? 'Uploading…' : 'Upload recording'}</Button>
</footer>
</form>
</Modal>;
}
function Calendar({
  meetings,
  onSelect,
  onCreate,
  notify,
  onImport
}) {
  const [anchor, setAnchor] = useState(new Date()),
    [events, setEvents] = useState(null);
  const monday = new Date(Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()));
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const days = Array.from({
      length: 5
    }, (_, i) => new Date(monday.getTime() + i * 86400000)),
    hours = Array.from({
      length: 12
    }, (_, i) => i + 7);
  return <section className='full-page calendar-page'>
<header className='page-header header-actions'>
<div>
<h1>Meeting calendar</h1>
<p>Make space for the conversation. We’ll help with the record.</p>
</div>
<Button primary icon={Plus} onClick={onCreate}>Add minutes taker</Button>
</header>
<div className='calendar-toolbar'>
<h2>{formatDate(anchor, {
          month: 'long',
          year: 'numeric'
        })}</h2>
<div>
<Button onClick={() => setAnchor(new Date())}>Today</Button>
<button className='icon-button border' aria-label='Previous week' onClick={() => setAnchor(new Date(anchor.getTime() - 7 * 86400000))}>
<CaretLeft size={20} />
</button>
<button className='icon-button border' aria-label='Next week' onClick={() => setAnchor(new Date(anchor.getTime() + 7 * 86400000))}>
<CaretRight size={20} />
</button>
<Button icon={ArrowClockwise} onClick={async () => {
          try {
            setEvents((await api('/calendar/sync', {
              method: 'POST'
            })).events);
          } catch (e) {
            notify(e.message);
          }
        }}>Import Outlook calendar</Button>
</div>
</div>
<div className='calendar-scroll'>
<div className='week-header'>
<div>HKT</div>{days.map(d => <div key={d.toISOString()} className={dateKey(d) === dateKey(new Date()) ? 'today' : ''}>
<span>{formatDate(d, {
              weekday: 'short'
            })}</span>
<strong>{formatDate(d, {
              day: 'numeric',
              month: 'short'
            })}</strong>
</div>)}</div>
<div className='week-grid'>
<div className='time-axis'>{hours.map(h => <span key={h}>{String(h).padStart(2, '0')}:00</span>)}</div>{days.map(day => <div className={'day-column ' + (dateKey(day) === dateKey(new Date()) ? 'today' : '')} key={day.toISOString()}>{hours.map(h => <div className='hour-line' key={h} />)}{meetings.filter(m => dateKey(m.scheduled_at) === dateKey(day)).map(m => {
            const [h, min] = time(m.scheduled_at).split(':').map(Number);
            return <button key={m.id} className={'calendar-event event-' + m.status} style={{
              top: Math.max(0, (h - 7) * 64 + min / 60 * 64),
              height: Math.max(62, Math.min(120, m.duration_minutes / 60 * 64))
            }} onClick={() => onSelect(m)}>
<strong>{m.title}</strong>
<span>{time(m.scheduled_at)} · {m.platform}</span>
<small>{labels[m.status]}</small>
</button>;
          })}</div>)}</div>
</div>
<p className='small muted'>Only authorised meetings are shown. Imported events require a separate capture assignment.</p>{events && <Modal title='Your upcoming Outlook events' onClose={() => setEvents(null)}>{events.length ? events.map(e => <button className='import-row' key={e.id} onClick={() => {
        setEvents(null);
        onImport(e);
      }}>
<span>
<strong>{e.title}</strong>
<small>{e.start?.dateTime}</small>
</span>
<Plus />
</button>) : <Empty title='No upcoming events' />}</Modal>}</section>;
}
