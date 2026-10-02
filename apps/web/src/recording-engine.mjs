export const RECORDING_LIMIT = 240 * 1024 * 1024;
export const UPLOAD_LIMIT = 250 * 1024 * 1024;
export function recordingKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function audioExtension(type) {
  if (/mp4|aac/i.test(type)) return 'm4a';
  if (/ogg/i.test(type)) return 'ogg';
  if (/wav/i.test(type)) return 'wav';
  return 'webm';
}
export function recordingMime(Recorder) {
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
    .find(type => Recorder.isTypeSupported(type)) || '';
}

// Event-driven controller: final dataavailable arrives before stop, never on a timer.
export class RecordingSession {
  constructor({getMedia, Recorder, now = () => performance.now(), onChange = () => {}, onChunk = () => {}, onFinish = () => {}}) {
    Object.assign(this, {getMedia, Recorder, now, onChange, onChunk, onFinish});
    this.state = 'idle'; this.chunks = []; this.bytes = 0; this.elapsed = 0; this.disposed = false;
  }
  update(state, error) { this.state = state; this.onChange({state, error, bytes: this.bytes}); }
  seconds() { return (this.elapsed + (this.state === 'recording' ? this.now() - this.since : 0)) / 1000; }
  async start() {
    if (this.state !== 'idle') return;
    this.update('requesting');
    try {
      const stream = await this.getMedia({audio: {echoCancellation: true, noiseSuppression: true}, video: false});
      if (this.disposed) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      const mimeType = recordingMime(this.Recorder);
      const recorder = new this.Recorder(stream, {...(mimeType ? {mimeType} : {}), audioBitsPerSecond: 96000});
      this.recorder = recorder; this.mimeType = recorder.mimeType || mimeType;
      recorder.ondataavailable = ({data}) => {
        if (!data.size) return;
        this.chunks.push(data); this.bytes += data.size;
        this.onChunk(data, this.chunks.length - 1, this.mimeType, this.seconds());
        if (this.bytes >= RECORDING_LIMIT) this.stop('Recording reached the size limit. Save this part before starting another meeting.');
      };
      recorder.onstop = () => {
        if (this.state === 'recording') this.elapsed += this.now() - this.since;
        this.release();
        const blob = new Blob(this.chunks, {type: this.mimeType || this.chunks[0]?.type || 'audio/webm'});
        this.update(blob.size ? 'ready' : 'idle', blob.size ? this.stopReason : 'No audio was captured. Check your microphone and try again.');
        if (blob.size) this.onFinish(blob, this.seconds());
      };
      recorder.onerror = () => this.stop('Recording was interrupted. Listen to the saved audio before uploading.');
      stream.getAudioTracks().forEach(track => {
        track.onended = () => this.stop('Microphone disconnected. Listen to the saved audio before uploading.');
        track.onmute = () => this.onChange({state: this.state, error: 'Microphone is temporarily unavailable. Keep this page open and check the recording.'});
      });
      recorder.start(5000); this.since = this.now(); this.update('recording');
    } catch (error) {
      this.release();
      if (this.disposed) return;
      const messages = {NotAllowedError: 'Microphone access was denied. Allow microphone access in your browser settings, then try again.', NotFoundError: 'No microphone was found on this device.', NotReadableError: 'The microphone is busy. Close the other app using it and try again.'};
      this.update('idle', messages[error.name] || 'Recording could not start in this browser. Try Safari on iPhone or Chrome on Android, or upload a recording.');
    }
  }
  pause() {
    if (this.state !== 'recording') return;
    this.recorder.pause(); this.elapsed += this.now() - this.since; this.update('paused');
  }
  resume() {
    if (this.state !== 'paused') return;
    this.recorder.resume(); this.since = this.now(); this.update('recording');
  }
  stop(reason) {
    if (!this.recorder || this.state === 'stopping' || this.state === 'ready') return;
    if (this.state === 'recording') this.elapsed += this.now() - this.since;
    this.stopReason = reason; this.update('stopping', reason);
    if (this.recorder.state !== 'inactive') this.recorder.stop();
  }
  release() { this.stream?.getTracks().forEach(t => { t.onended = null; t.onmute = null; t.stop(); }); }
  dispose() { this.disposed = true; this.stop(); this.release(); }
}
