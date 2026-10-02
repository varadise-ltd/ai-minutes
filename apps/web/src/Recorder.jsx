import React, {useEffect, useRef, useState} from 'react';
import {Microphone, Pause, Play, Stop, UploadSimple, DownloadSimple} from '@phosphor-icons/react';
import {Button, Modal} from './ui';
import {api, stamp} from './api';
import {RecordingSession, audioExtension, UPLOAD_LIMIT, recordingKey} from './recording-engine.mjs';
import {saveChunk, completeDraft, loadDraft, deleteDraft} from './recording-store.mjs';

export function Recorder({meeting, user, onClose, onSaved, notify}) {
  const key = `${user.org_id}:${user.id}:${meeting.id}`;
  const [state, setState] = useState('loading'), [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState(null), [url, setUrl] = useState(''), [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(''), [consent, setConsent] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false), [uploadPercent, setUploadPercent] = useState(null);
  const session = useRef(), alive = useRef(true), queue = useRef(Promise.resolve()), wake = useRef(), xhr = useRef();
  const recordingId = useRef(null);
  if (!recordingId.current) recordingId.current = recordingKey();
  const phase = useRef(state); phase.current = state;
  const active = ['recording', 'paused', 'stopping', 'requesting'].includes(state);
  const supported = window.isSecureContext && navigator.mediaDevices?.getUserMedia && window.MediaRecorder;
  useEffect(() => {
    alive.current = true;
    loadDraft(key).then(d => {
      if (!alive.current) return;
      if (d?.blob.size) { recordingId.current = d.recordingId || recordingId.current; setBlob(d.blob); setSeconds(d.seconds || 0); setState('ready'); setError(d.complete ? 'Recovered an unsent recording from this browser.' : 'Recovered audio after an interruption. Playback may be incomplete; listen before uploading.'); }
      else setState('idle');
    }).catch(() => { if (alive.current) { setState('idle'); setStorageWarning('Local recovery is unavailable. Download a copy before leaving this page.'); } });
    const protect = e => { if (['recording','paused','stopping','ready','uploading','requesting'].includes(phase.current)) { e.preventDefault(); e.returnValue = ''; } };
    const hidden = () => { if (document.hidden && ['recording','paused'].includes(phase.current)) setError('Keep this page open. Switching apps or locking the phone can interrupt recording; check playback afterwards.'); };
    window.addEventListener('beforeunload', protect); document.addEventListener('visibilitychange', hidden);
    const timer = setInterval(() => { if (session.current && ['recording','paused'].includes(phase.current)) setSeconds(session.current.seconds()); }, 250);
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener('beforeunload', protect); document.removeEventListener('visibilitychange', hidden); session.current?.dispose(); wake.current?.release().catch(() => {}); xhr.current?.abort(); };
  }, [key]);
  useEffect(() => { if (!blob) { setUrl(''); return; } const objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); return () => URL.revokeObjectURL(objectUrl); }, [blob]);
  function persist(fn) { queue.current = queue.current.then(fn).catch(() => { if (alive.current) setStorageWarning('Browser storage is full or unavailable. Keep this page open and download the recording before leaving.'); }); }
  async function start() {
    if (!supported || !consent) return;
    setError(''); setSeconds(0);
    session.current = new RecordingSession({getMedia: c => navigator.mediaDevices.getUserMedia(c), Recorder: MediaRecorder,
      onChange: ({state: next, error: message}) => { if (alive.current) { setState(next); if (message) setError(message); } },
      onChunk: (data, index, mime, elapsed) => persist(() => saveChunk(key, data, index, mime, elapsed, recordingId.current)),
      onFinish: (data, elapsed) => { persist(() => completeDraft(key, data.type, elapsed, recordingId.current)); if (alive.current) { setBlob(data); setSeconds(elapsed); } wake.current?.release().catch(() => {}); }
    });
    await session.current.start();
    if (alive.current && session.current.state === 'recording') {
      try { const lock = await navigator.wakeLock?.request('screen'); if (!alive.current || session.current.state !== 'recording') await lock?.release(); else wake.current = lock; } catch { /* Recording still works without a wake lock. */ }
    }
  }
  async function discard() {
    await queue.current;
    try { await deleteDraft(key); } catch { setError('Could not remove the local copy. Please try again.'); return; }
    setBlob(null); setSeconds(0); setState('idle'); setError(''); setConfirmDiscard(false); session.current = null;
    recordingId.current = recordingKey();
  }
  function close() {
    if (phase.current === 'requesting') { session.current?.dispose(); onClose(); return; }
    if (['requesting','recording','paused','stopping','uploading'].includes(phase.current)) { setError('Stop the recording and finish or cancel the upload before closing.'); return; }
    onClose();
  }
  async function upload() {
    if (!blob || blob.size > UPLOAD_LIMIT) return;
    setState('uploading'); setError(''); setUploadPercent(0);
    try {
      const fileName = `meeting-${meeting.id}-${recordingId.current}.${audioExtension(blob.type)}`;
      // A lost upload response can be reconciled without duplicating or replacing a recording.
      const existing = await api(`/meetings/${meeting.id}`);
      if (existing.file_path && existing.file_name !== fileName) throw new Error('This meeting already has a different recording. Download this copy and create another meeting.');
      if (!existing.file_path) await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest(); xhr.current = request;
        request.open('POST', `/api/meetings/${meeting.id}/upload`); request.timeout = 600000;
        request.upload.onprogress = e => { if (e.lengthComputable && alive.current) setUploadPercent(Math.round(e.loaded / e.total * 100)); };
        request.onload = () => { let result; try { result = JSON.parse(request.responseText); } catch { result = {}; } request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(result.error || 'Upload failed. Your local recording is retained.')); };
        request.onerror = request.ontimeout = () => reject(new Error('Connection interrupted. Your recording is retained; retry when connected.'));
        request.onabort = () => reject(new Error('Upload cancelled. Your recording is retained.'));
        const form = new FormData(); form.set('file', blob, fileName); request.send(form);
      });
      await queue.current; await deleteDraft(key).catch(() => {});
      if (alive.current) { setState('saved'); notify('Recording saved. Transcribe it from the meeting workspace.'); await onSaved(); }
    } catch (e) { if (alive.current) { setState('ready'); setError(e.message); } }
    finally { xhr.current = null; }
  }
  return <Modal title='Record a meeting' onClose={close}>
    <p className='muted'>{meeting.title || 'Your meeting'} · Audio stays on this device until you upload it.</p>
    {!supported && <div className='notice warm'>Microphone recording needs a trusted HTTPS address (or localhost on this PC) and a supported browser. Open the secure phone link in Safari on iPhone or Chrome on Android. You can also upload an existing recording.</div>}
    <div className={'recorder-display ' + (state === 'recording' ? 'is-recording' : '')}>
      <Microphone size={36}/><strong aria-label='Recording duration'>{stamp(seconds)}</strong>
      <span role='status'>{({loading:'Checking for unsent audio…',idle:'Ready when you are',requesting:'Waiting for microphone permission…',recording:'Recording',paused:'Paused',stopping:'Finishing recording…',ready:'Ready to listen and upload',uploading:`Uploading · ${uploadPercent || 0}%`,saved:'Recording saved'})[state]}</span>
    </div>
    {error && <div className='notice warm' role='alert'>{error}</div>}
    {storageWarning && <p className='notice warm'>{storageWarning}</p>}
    {state === 'idle' && <label className='checkbox consent'><input type='checkbox' checked={consent} onChange={e => setConsent(e.target.checked)}/>Participants have been informed and I am authorised to record this meeting.</label>}
    <div className='recorder-controls'>
      {state === 'idle' && <Button primary icon={Microphone} disabled={!supported || !consent} onClick={start}>Start recording</Button>}
      {state === 'recording' && <Button icon={Pause} onClick={() => session.current.pause()}>Pause</Button>}
      {state === 'paused' && <Button icon={Play} onClick={() => session.current.resume()}>Resume</Button>}
      {['recording','paused'].includes(state) && <Button primary icon={Stop} onClick={() => session.current.stop()}>Stop recording</Button>}
    </div>
    {active && <p className='muted small'>Keep this page open and the phone unlocked. A call or app switch can interrupt capture. Recording stops near 240 MB.</p>}
    {blob && <div className='recording-preview'><audio controls src={url} aria-label='Recorded audio playback'/><p className='muted small'>{(blob.size/1024/1024).toFixed(1)} MB · {audioExtension(blob.type).toUpperCase()} · Listen before uploading.</p><a className='button' download={`meeting-recording.${audioExtension(blob.type)}`} href={url}><DownloadSimple size={18}/>Download a copy</a></div>}
    {blob?.size > UPLOAD_LIMIT && <div className='notice warm'>This recording exceeds 250 MB. Download it and split it into smaller files before uploading.</div>}
    {confirmDiscard ? <div className='notice warm'><p>Discard this unsent recording from this browser? Download a copy first if you need it.</p><div className='button-row'><Button onClick={() => setConfirmDiscard(false)}>Keep recording</Button><Button onClick={discard}>Discard recording</Button></div></div> : <footer className='modal-actions'>
      <Button disabled={active || state === 'uploading'} onClick={close}>{blob ? 'Keep for later' : 'Close'}</Button>
      {state === 'ready' && <><Button onClick={() => setConfirmDiscard(true)}>Record again</Button><Button primary icon={UploadSimple} disabled={!blob || blob.size > UPLOAD_LIMIT} onClick={upload}>Upload recording</Button></>}
      {state === 'uploading' && <Button onClick={() => xhr.current?.abort()}>Cancel upload</Button>}
    </footer>}
    {blob && <p className='muted small'>Unsent audio is stored in this browser when storage is available. Reopen this meeting on the same device and address to recover it. Browser storage is not a backup.</p>}
  </Modal>;
}
