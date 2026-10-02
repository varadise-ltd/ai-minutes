import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLlmURL, resolveLlmURL } from '../services/api/llm-endpoint.mjs';

test('HTTP gateway accepts exact local origin and Docker routes loopback to host', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(validateLlmURL(`http://${host}:20128/v1/`, {}), `http://${host}:20128/v1`);
    assert.equal(resolveLlmURL(`http://${host}:20128/v1/`, { LLM_LOOPBACK_HOST: 'host.docker.internal' }), 'http://host.docker.internal:20128/v1');
  }
  assert.equal(resolveLlmURL('http://localhost:20128/v1', {}), 'http://localhost:20128/v1');
  assert.equal(validateLlmURL('https://api.openai.com/v1/', {}), 'https://api.openai.com/v1');
  assert.equal(validateLlmURL('http://gateway:8080/v1', {LLM_ALLOWED_HTTP_ORIGINS:'http://gateway:8080'}), 'http://gateway:8080/v1');
});

test('endpoint policy rejects unconfigured origins, deceptive hosts and embedded secrets', () => {
  for (const url of ['http://localhost:8080/v1','http://localhost.evil.test:20128/v1','http://169.254.169.254/v1','http://public.example/v1','ftp://localhost:20128/v1','http://user:secret@localhost:20128/v1','http://localhost:20128/v1?key=secret','https://api.openai.com/v1#secret','https://evil.test/v1','not a url']) {
    assert.throws(() => validateLlmURL(url, {}), {status:400});
  }
  assert.throws(() => validateLlmURL('http://localhost:20128/v1', {LLM_ALLOWED_HTTP_ORIGINS:''}), {status:400});
  assert.throws(() => resolveLlmURL('http://localhost:20128/v1', {LLM_LOOPBACK_HOST:'other-host'}), {status:400});
});
