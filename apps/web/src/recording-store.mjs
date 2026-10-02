function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ai-minutes-recordings', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('drafts'); request.result.createObjectStore('chunks'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction(mode, run) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(['drafts', 'chunks'], mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Local storage was interrupted.'));
      run(tx.objectStore('drafts'), tx.objectStore('chunks'), value => { result = value; });
    });
  } finally { db.close(); }
}
export function saveChunk(key, data, index, mime, seconds, recordingId) {
  return transaction('readwrite', (drafts, chunks) => {
    chunks.put(data, [key, index]); drafts.put({mime, seconds, recordingId, updatedAt: Date.now(), complete: false}, key);
  });
}
export function completeDraft(key, mime, seconds, recordingId) {
  return transaction('readwrite', drafts => drafts.put({mime, seconds, recordingId, updatedAt: Date.now(), complete: true}, key));
}
export function loadDraft(key) {
  return transaction('readonly', (drafts, chunks, done) => {
    const meta = drafts.get(key);
    meta.onsuccess = () => {
      if (!meta.result) { done(null); return; }
      const parts = chunks.getAll(IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]));
      parts.onsuccess = () => done({...meta.result, blob: new Blob(parts.result, {type: meta.result.mime})});
    };
  });
}
export function deleteDraft(key) {
  return transaction('readwrite', (drafts, chunks) => {
    drafts.delete(key); chunks.delete(IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]));
  });
}
