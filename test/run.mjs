import { createHandler } from '../lib/handler.mjs';
import { createMemoryStore } from './memory-store.mjs';

const handler = createHandler(createMemoryStore());
const results = [];

function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

async function call(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await handler(new Request('http://localhost' + path, { ...options, headers }));
  let body = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body, headers: res.headers };
}

let r = await call('/api/health');
check(
  'health',
  r.status === 200 && r.body.ok === true && r.body.storage === 'netlify-blobs' && r.headers.get('access-control-allow-origin') === '*',
  `status=${r.status}`
);

r = await call('/api/register', { method: 'OPTIONS' });
check('OPTIONS', r.status === 204 && r.headers.get('access-control-allow-origin') === '*', `status=${r.status}`);

const username = 'NetlifyTest';
r = await call('/api/register', {
  method: 'POST',
  body: JSON.stringify({ username, password: 'secret123', repeat: 'secret123' })
});
check('register', r.status === 201 && Boolean(r.body.token) && r.body.user.username === username, `status=${r.status} ${r.body?.error || ''}`);
const token = r.body?.token;
const uuid = r.body?.user?.uuid;

check('offline uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid || ''), uuid);

r = await call('/api/me', { headers: { Authorization: `Bearer ${token}` } });
check('me after register', r.status === 200 && r.body.user.username === username, `status=${r.status}`);

r = await call('/api/register', {
  method: 'POST',
  body: JSON.stringify({ username: username.toUpperCase(), password: 'secret123', repeat: 'secret123' })
});
check('duplicate username', r.status === 409, `status=${r.status}`);

r = await call('/api/register', {
  method: 'POST',
  body: JSON.stringify({ username: 'ab', password: 'secret123', repeat: 'secret123' })
});
check('bad username', r.status === 400, `status=${r.status}`);

r = await call('/api/register', {
  method: 'POST',
  body: JSON.stringify({ username: 'OtherUser', password: 'secret123', repeat: 'different' })
});
check('password mismatch', r.status === 400, `status=${r.status}`);

r = await call('/api/login', {
  method: 'POST',
  body: JSON.stringify({ username, password: 'wrongpass' })
});
check('wrong password', r.status === 401, `status=${r.status}`);

r = await call('/api/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'NoSuchUser', password: 'secret123' })
});
check('unknown user', r.status === 401, `status=${r.status}`);

r = await call('/api/login', {
  method: 'POST',
  body: JSON.stringify({ username, password: 'secret123' })
});
check('login', r.status === 200 && Boolean(r.body.token), `status=${r.status} ${r.body?.error || ''}`);
const token2 = r.body?.token;

r = await call('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${token2}` } });
check('logout', r.status === 200, `status=${r.status}`);

r = await call('/api/me', { headers: { Authorization: `Bearer ${token2}` } });
check('me after logout', r.status === 401, `status=${r.status}`);

r = await call('/api/me', { headers: { Authorization: `Bearer ${token}` } });
check('first session still valid', r.status === 200, `status=${r.status}`);

r = await call('/api/nope');
check('unknown endpoint', r.status === 404, `status=${r.status}`);

r = await call('/api/login', {
  method: 'POST',
  body: JSON.stringify({ username, password: 'x'.repeat(17 * 1024) })
});
check('oversized body', r.status === 400, `status=${r.status}`);

r = await call('/api/login', { method: 'POST', body: '{not json' });
check('bad json', r.status === 400, `status=${r.status}`);

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
