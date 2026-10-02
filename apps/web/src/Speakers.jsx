import React, {useEffect, useRef, useState} from 'react';
import {Play, Plus, FloppyDisk, MagnifyingGlass} from '@phosphor-icons/react';
import {Modal, Button, Field} from './ui';
import {api, stamp} from './api';
import {recordingKey} from './recording-engine.mjs';

export function Speakers({meeting, source, onClose, onSaved, notify, initialSpeakerId}) {
  const createRevision=['IN_REVIEW','APPROVED'].includes(meeting.status);
  const original = source.segments.map(s => ({...s, speakerId: s.speakerId || s.speaker || 'unmapped'}));
  const [names, setNames] = useState(() => Object.fromEntries(original.map(s => [s.speakerId, s.speaker])));
  const [assignments, setAssignments] = useState({}), [search, setSearch] = useState(''), [selected, setSelected] = useState(initialSpeakerId||'all');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [playing, setPlaying] = useState(null);
  const audio = useRef(), endAt = useRef(null);
  useEffect(() => () => { audio.current?.pause(); }, []);
  const changed = original.some(s => (assignments[s.id] || s.speakerId) !== s.speakerId || names[s.speakerId] !== s.speaker);
  async function sample(segment, index) {
    if (!audio.current) return;
    if (playing === segment.id) { audio.current.pause(); setPlaying(null); return; }
    try {
      endAt.current = Math.min(segment.start + 12, segment.end > segment.start ? segment.end : original[index + 1]?.start > segment.start ? original[index + 1].start : segment.start + 12);
      audio.current.currentTime = segment.start; await audio.current.play(); setPlaying(segment.id); setError('');
    } catch { setError('Audio could not play. Use the playback controls or check the recording.'); }
  }
  async function save() {
    setBusy(true); setError('');
    try {
      await api(`/meetings/${meeting.id}/speakers`, {method:'PUT', body: {revision:meeting.revision, transcriptId:source.id,createRevision,
        names: Object.entries(names).map(([id,name]) => ({id,name})), corrections:Object.entries(assignments).map(([segmentId,speakerId]) => ({segmentId,speakerId}))}});
      notify('Speaker changes saved as a new transcript version. Review or regenerate the draft minutes.'); await onSaved(); onClose();
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Modal title='Name & correct speakers' wide onClose={() => !busy && onClose()}>
    <p className='muted'>Name a speaker once to update their segments in this meeting. Listen to a sample, then correct any segment assigned to the wrong person.</p>
    {createRevision&&<p className='notice warm'>Saving creates a new correction draft. The current {meeting.status==='APPROVED'?'approved':'submitted'} document and transcript remain unchanged in version history. The corrected draft must be reviewed and approved again.</p>}
    <div className='speaker-cards'>{Object.entries(names).map(([id,name], n) => {
      const segments = original.filter(s => (assignments[s.id] || s.speakerId) === id), first = segments[0];
      return <section className='speaker-card' key={id}><div className='speaker-avatar'>{n+1}</div><Field label={`Speaker ${n+1} name`} hint={`${segments.length} segment${segments.length === 1 ? '' : 's'}`}><input maxLength={100} value={name} autoFocus={id===initialSpeakerId} disabled={busy} onChange={e => setNames({...names,[id]:e.target.value})}/></Field><Button icon={Play} disabled={!meeting.file_path || !first} onClick={() => sample(first,original.indexOf(first))}>{playing === first?.id ? 'Stop sample' : 'Listen to sample'}</Button></section>;
    })}</div>
    <Button icon={Plus} disabled={busy} onClick={() => {const id=`manual-${recordingKey()}`;setNames({...names,[id]:`New speaker ${Object.keys(names).length+1}`});}}>Add another speaker</Button>
    {!meeting.file_path && <p className='notice neutral'>No audio is attached to this transcript. You can still correct names and assignments.</p>}
    {meeting.file_path && <audio ref={audio} controls className='speaker-audio' src={`/api/meetings/${meeting.id}/audio`} aria-label='Speaker sample playback' onTimeUpdate={() => {if(endAt.current !== null && audio.current.currentTime >= endAt.current){audio.current.pause();endAt.current=null;setPlaying(null);}}} onEnded={() => setPlaying(null)} onPause={() => setPlaying(null)}/>}
    <div className='speaker-filters'><div className='input-icon'><MagnifyingGlass size={18}/><input aria-label='Search speaker segments' value={search} onChange={e => setSearch(e.target.value)} placeholder='Find a phrase…'/></div><select aria-label='Filter speaker segments' value={selected} onChange={e => setSelected(e.target.value)}><option value='all'>All speakers</option>{Object.entries(names).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></div>
    <div className='speaker-segment-list'>{original.map((s,index) => ({s,index})).filter(({s}) => (selected === 'all' || (assignments[s.id] || s.speakerId) === selected) && (s.text+(s.displayText||'')).toLowerCase().includes(search.toLowerCase())).map(({s,index}) => <article className='speaker-segment' key={s.id}>
      <div><button className='text-button' disabled={!meeting.file_path} onClick={() => sample(s,index)} aria-label={`Play segment ${index+1}`}><Play size={16}/>{stamp(s.start)}</button><select aria-label={`Segment ${index+1} speaker`} disabled={busy} value={assignments[s.id] || s.speakerId} onChange={e => setAssignments({...assignments,[s.id]:e.target.value})}>{Object.entries(names).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></div><p>{s.displayText||s.text}</p>
    </article>)}</div>
    {error && <div className='notice warm' role='alert'>{error}</div>}
    <p className='small muted'>Saving retains previous transcript versions and clears evidence verification. Existing draft text is retained: review or regenerate it to reflect corrected names. Names are specific to this meeting; voices are not enrolled for future recognition.</p>
    <footer className='modal-actions'><Button disabled={busy} onClick={onClose}>Cancel</Button><Button primary icon={FloppyDisk} disabled={busy || !changed || Object.values(names).some(n => !n.trim())} onClick={save}>{busy ? 'Saving…' : createRevision?'Create correction draft':'Save speaker changes'}</Button></footer>
  </Modal>;
}
