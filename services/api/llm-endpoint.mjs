const localHttpOrigins = 'http://localhost:20128,http://127.0.0.1:20128,http://[::1]:20128,http://host.docker.internal:20128';
const list = value => value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export function validateLlmURL(value, env = process.env) {
  const fail = message => Object.assign(new Error(message), { status: 400 });
  let url;
  try { url = new URL(value || 'https://api.openai.com/v1'); }
  catch { throw fail('Enter a valid Minutes AI base URL.'); }
  if (url.username || url.password || url.search || url.hash) throw fail('The Minutes AI base URL cannot contain credentials, query parameters or a fragment.');
  if (url.protocol === 'http:') {
    const allowed = list(env.LLM_ALLOWED_HTTP_ORIGINS ?? localHttpOrigins);
    if (!allowed.includes(url.origin.toLowerCase())) throw fail('This HTTP gateway is not enabled. Add its exact origin (http://host:port) to LLM_ALLOWED_HTTP_ORIGINS. The local gateway on port 20128 is enabled by default.');
  } else if (url.protocol === 'https:') {
    const allowed = list(env.LLM_ALLOWED_HOSTS || 'api.openai.com,openrouter.ai');
    if (!allowed.includes(url.hostname.toLowerCase()) || url.port) throw fail('The HTTPS endpoint must use a host in LLM_ALLOWED_HOSTS on the standard HTTPS port.');
  } else throw fail('Minutes AI supports HTTP or HTTPS endpoints only.');
  return url.toString().replace(/\/+$/, '');
}

export function resolveLlmURL(value, env = process.env) {
  const url = new URL(validateLlmURL(value, env));
  // In Docker, loopback refers to the container. Compose opts into host routing.
  if (url.protocol === 'http:' && env.LLM_LOOPBACK_HOST && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    url.hostname = env.LLM_LOOPBACK_HOST;
    return validateLlmURL(url.toString(), env);
  }
  return url.toString().replace(/\/+$/, '');
}
