import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { query, pool } from '../../services/api/db.mjs';
import { hashPassword, checkPassword } from '../../packages/domain/index.mjs';

test('self-service profiles and passwords preserve access, isolate identities and revoke sessions', async () => {
  const org = randomUUID(), demoOrg = randomUUID();
  const admin = randomUUID(), member = randomUUID(), microsoft = randomUUID(), demo = randomUUID();
  const original = 'Test-only-original-phrase', replacement = 'Newpass8';
  const base = process.env.TEST_URL || 'http://127.0.0.1:5000';
  async function session(id) {
    const token = randomBytes(32).toString('hex');
    await query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex'), id]);
    return 'minutes_session=' + token;
  }
  async function request(path, method = 'GET', body, cookie) {
    const r = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
  }
  const credentials = { currentPassword: original, newPassword: replacement, confirmPassword: replacement };
  try {
    await query('INSERT INTO organizations(id,name,demo) VALUES($1,$2,false),($3,$4,true)', [org, 'Account test ' + org, demoOrg, 'Sample account test ' + demoOrg]);
    for (const [id, company, roles, local] of [[admin, org, ['ORG_ADMIN'], true], [member, org, ['MEMBER'], true], [microsoft, org, ['MEMBER'], false], [demo, demoOrg, ['ORG_ADMIN'], true]]) {
      await query('INSERT INTO users(id,org_id,name,email,roles,password_hash,external_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, company, 'Account tester', id + '@example.invalid', roles, local ? hashPassword(original) : null, local ? null : randomUUID()]);
    }
    const a = await session(admin), b = await session(member), b2 = await session(member), m = await session(microsoft), d = await session(demo);
    // Legacy passwords remain usable; the new policy applies only when setting a password.
    assert.equal((await request('/auth/login', 'POST', { email: member + '@example.invalid', password: original })).status, 200);
    const newUser = { name: 'Policy tester', email: randomUUID() + '@example.invalid', roles: ['MEMBER'], unitIds: [] };
    for (const password of ['Abcde12', 'abcdefg1', 'ABCDEFG1', 'Abcdefgh']) {
      assert.equal((await request('/admin/users', 'POST', { ...newUser, password }, a)).status, 400);
      assert.equal((await request('/auth/setup', 'POST', { company: 'Policy test', name: 'Policy tester', email: newUser.email, password })).status, 400);
    }
    assert.equal((await request('/admin/users', 'POST', { ...newUser, password: replacement }, a)).status, 201);
    assert.equal((await request('/account/profile', 'PATCH', { name: 'Unauthenticated' })).status, 401);
    assert.equal((await request('/account/password', 'POST', credentials)).status, 401);
    const me = (await request('/me', 'GET', null, b)).data.user;
    assert.equal(me.hasLocalPassword, true); assert.equal('password_hash' in me, false);
    assert.equal((await request('/me', 'GET', null, m)).data.user.hasLocalPassword, false);
    assert.equal((await request('/account/profile', 'PATCH', { name: '  Updated tester  ' }, b)).status, 200);
    assert.equal((await request('/me', 'GET', null, b)).data.user.name, 'Updated tester');
    assert.equal((await request('/me', 'GET', null, a)).data.user.name, 'Account tester');
    for (const body of [{ name: ' ', }, { name: 'No escalation', roles: ['ORG_ADMIN'] }, { name: 'Wrong identity', id: admin }, { name: 'Other email', email: 'other@example.invalid' }]) {
      assert.equal((await request('/account/profile', 'PATCH', body, b)).status, 400);
    }
    assert.equal((await request('/admin/users/' + admin, 'PATCH', { active: false, roles: ['MEMBER'], unitIds: [] }, a)).status, 409);
    assert.equal((await request('/account/profile', 'PATCH', { name: 'No demo edits' }, d)).status, 403);
    assert.equal((await request('/account/password', 'POST', credentials, d)).status, 403);
    assert.equal((await request('/account/password', 'POST', credentials, m)).status, 409);
    assert.equal((await request('/account/password', 'POST', { ...credentials, currentPassword: 'wrong' }, b)).status, 400);
    assert.equal((await request('/account/password', 'POST', { ...credentials, newPassword: 'short', confirmPassword: 'short' }, b)).status, 400);
    assert.equal((await request('/account/password', 'POST', { ...credentials, confirmPassword: original }, b)).status, 400);
    assert.equal((await request('/account/password', 'POST', { ...credentials, newPassword: original, confirmPassword: original }, b)).status, 400);
    for (const password of ['abcdefg1', 'ABCDEFG1', 'Abcdefgh']) {
      assert.equal((await request('/account/password', 'POST', { ...credentials, newPassword: password, confirmPassword: password }, b)).status, 400);
    }
    const before = (await query('SELECT password_hash FROM users WHERE id=$1', [member])).rows[0].password_hash;
    assert.equal(checkPassword(original, before), true);
    assert.equal((await request('/me', 'GET', null, b2)).status, 200);
    const changed = await request('/account/password', 'POST', credentials, b);
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal(changed.data.signInRequired, true); assert.equal(changed.cookie, 'minutes_session=');
    assert.equal((await request('/me', 'GET', null, b)).status, 401);
    assert.equal((await request('/me', 'GET', null, b2)).status, 401);
    assert.equal((await request('/me', 'GET', null, a)).status, 200);
    const saved = (await query('SELECT password_hash,roles FROM users WHERE id=$1', [member])).rows[0];
    assert.notEqual(saved.password_hash, replacement); assert.equal(checkPassword(replacement, saved.password_hash), true);
    assert.deepEqual(saved.roles, ['MEMBER']);
    assert.equal((await request('/auth/login', 'POST', { email: member + '@example.invalid', password: original })).status, 401);
    const signedIn = await request('/auth/login', 'POST', { email: member + '@example.invalid', password: replacement });
    assert.equal(signedIn.status, 200); assert.equal((await request('/me', 'GET', null, signedIn.cookie)).status, 200);
    // Two simultaneous changes from the same old password cannot both succeed.
    const changes = await Promise.all([1, 2].map(i => request('/account/password', 'POST', { currentPassword: original, newPassword: replacement + i, confirmPassword: replacement + i }, a)));
    assert.equal(changes.filter(r => r.status === 200).length, 1);
    assert.equal(changes.filter(r => r.status === 401).length, 1);
    const events = (await query('SELECT action,detail FROM audit WHERE org_id=$1', [org])).rows;
    assert.equal(events.filter(e => e.action === 'account.password_changed').length, 2);
    for (const secret of [original, replacement, saved.password_hash]) assert.equal(JSON.stringify(events).includes(secret), false);
    // Per-user rate limiting also covers repeated current-password failures.
    for (let i = 0; i < 10; i++) await request('/account/password', 'POST', credentials, m);
    assert.equal((await request('/account/password', 'POST', credentials, m)).status, 429);
  } finally {
    await query('DELETE FROM audit WHERE org_id=ANY($1::uuid[])', [[org, demoOrg]]);
    await query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [[admin, member, microsoft, demo]]);
    await query('DELETE FROM users WHERE org_id=ANY($1::uuid[])', [[org, demoOrg]]);
    await query('DELETE FROM organizations WHERE id=ANY($1::uuid[])', [[org, demoOrg]]);
    await pool.end();
  }
});
