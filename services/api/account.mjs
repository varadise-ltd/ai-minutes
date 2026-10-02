import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { createHash } from 'node:crypto';
import { tx, audit } from './db.mjs';
import { checkPassword, hashPassword } from '../../packages/domain/index.mjs';
import { newPasswordSchema } from './password-policy.mjs';

export function accountRoutes(app, { wrap, fail, sessionCookie }) {
  // Lock the identity before checking the session, serializing password changes.
  async function currentUser(db, req) {
    if (req.user.demo) throw fail(403, 'Account changes are unavailable in the sample workspace.');
    const { rows } = await db.query('SELECT * FROM users WHERE id=$1 AND org_id=$2 AND active=true FOR UPDATE', [req.user.id, req.user.org_id]);
    const tokenHash = createHash('sha256').update(req.cookies.minutes_session).digest('hex');
    const valid = await db.query('SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now()', [tokenHash, req.user.id]);
    if (!rows[0] || !valid.rowCount) throw fail(401, 'Your session expired. Please sign in.');
    return rows[0];
  }

  app.patch('/api/account/profile', wrap(async (req, res) => {
    const v = z.object({ name: z.string().trim().min(2).max(100) }).strict().parse(req.body);
    await tx(async db => {
      const user = await currentUser(db, req);
      await db.query('UPDATE users SET name=$2 WHERE id=$1', [user.id, v.name]);
      await audit(db, user, 'account.profile_changed', null, { fields: ['name'] });
    });
    res.json({ name: v.name });
  }));

  app.post('/api/account/password', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    keyGenerator: req => req.user.id,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many password attempts. Try again in 15 minutes.' }
  }), wrap(async (req, res) => {
    const v = z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: newPasswordSchema,
      confirmPassword: z.string().min(8).max(200)
    }).strict().parse(req.body);
    if (v.newPassword !== v.confirmPassword) throw fail(400, 'The new passwords do not match.');
    await tx(async db => {
      const user = await currentUser(db, req);
      if (!user.password_hash) throw fail(409, 'This account has no local password. Manage your password with your sign-in provider.');
      if (!checkPassword(v.currentPassword, user.password_hash)) throw fail(400, 'Your current password is incorrect.');
      if (checkPassword(v.newPassword, user.password_hash)) throw fail(400, 'Choose a different password from your current password.');
      await db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [user.id, hashPassword(v.newPassword)]);
      await db.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
      await audit(db, user, 'account.password_changed', null, { sessionsRevoked: true });
    });
    res.clearCookie('minutes_session', sessionCookie(req)).json({ ok: true, signInRequired: true });
  }));
}
