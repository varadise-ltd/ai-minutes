// Keep stable diarization identities separate from reviewer-supplied names.
export function speakerSegments(segments) {
  return segments.map(s => ({...s, speakerId: s.speakerId || s.speaker || 'unmapped',
    sourceSpeakerId: s.sourceSpeakerId || s.speakerId || s.speaker || 'unmapped'}));
}

export function correctSpeakers(segments, names, corrections) {
  const original = speakerSegments(segments);
  const known = new Set(original.map(s => s.speakerId));
  const labels = new Map(original.map(s => [s.speakerId, s.speaker]));
  for (const entry of names) {
    if (!known.has(entry.id) && !/^manual-[a-zA-Z0-9-]{1,60}$/.test(entry.id)) throw new Error('Unknown speaker. Add a new speaker before assigning segments.');
    if (!entry.name.trim()) throw new Error('Enter a name or keep the original speaker label.');
    if (labels.has(entry.id) && names.filter(n => n.id === entry.id).length > 1) throw new Error('Duplicate speaker name entry.');
    labels.set(entry.id, entry.name.trim());
  }
  const changes = new Map();
  for (const change of corrections) {
    if (!original.some(s => s.id === change.segmentId)) throw new Error('Transcript segment not found.');
    if (!labels.has(change.speakerId)) throw new Error('Choose a known speaker for each segment.');
    if (changes.has(change.segmentId)) throw new Error('Duplicate segment correction.');
    changes.set(change.segmentId, change.speakerId);
  }
  return original.map(s => {
    const speakerId = changes.get(s.id) || s.speakerId;
    return {...s, speakerId, speaker: labels.get(speakerId)};
  });
}
