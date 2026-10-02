import React, { useState } from 'react';
import { UserCircle, LockKey, ShieldCheck } from '@phosphor-icons/react';
import { api } from './api';
import { Button, Field } from './ui';
import { newPasswordProps, passwordHint } from './passwordPolicy';
import './account.css';

export function Account({ user, units, onProfileSaved, onPasswordChanged }) {
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState('');
  const [profileStatus, setProfileStatus] = useState('');
  const [profileError, setProfileError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  async function saveProfile(event) {
    event.preventDefault();
    setBusy('profile'); setProfileError(''); setProfileStatus('');
    try {
      const saved = await api('/account/profile', { method: 'PATCH', body: { name } });
      setName(saved.name); onProfileSaved(saved); setProfileStatus('Your display name has been saved.');
    } catch (error) { setProfileError(error.message); }
    finally { setBusy(''); }
  }
  async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const body = Object.fromEntries(['currentPassword', 'newPassword', 'confirmPassword'].map(key => [key, values.get(key)]));
    setPasswordError('');
    if (body.newPassword !== body.confirmPassword) { setPasswordError('The new passwords do not match.'); return; }
    if (body.newPassword === body.currentPassword) { setPasswordError('Choose a different password from your current password.'); return; }
    setBusy('password');
    try {
      await api('/account/password', { method: 'POST', body });
      form.reset(); onPasswordChanged();
    } catch (error) { setPasswordError(error.message); }
    finally { setBusy(''); }
  }
  return <section className='full-page account-page'>
    <header className='page-header'><h1>My account</h1><p>Manage your profile and sign-in details.</p></header>
    {user.demo && <div className='notice'>You are viewing a sample account. Sign in to your company workspace to change your profile or password.</div>}
    <div className='account-layout'>
      <div>
        <section className='account-card' aria-labelledby='profile-heading'>
          <h2 id='profile-heading'><UserCircle size={24} />Profile</h2>
          <form onSubmit={saveProfile}>
            <Field label='Display name'><input value={name} onChange={e => setName(e.target.value)} autoComplete='name' required minLength={2} maxLength={100} disabled={user.demo || Boolean(busy)} /></Field>
            <Field label='Email address' hint='Your sign-in identity. Contact your administrator to change your email.'><input type='email' value={user.email} readOnly autoComplete='username' /></Field>
            {user.external_id && <p className='account-help'>Your Microsoft 365 display name may be restored the next time your administrator syncs the directory.</p>}
            {profileError && <p className='account-error' role='alert'>{profileError}</p>}
            <p className='account-status' role='status'>{profileStatus}</p>
            <Button primary disabled={user.demo || Boolean(busy) || name.trim() === user.name || name.trim().length < 2}>{busy === 'profile' ? 'Saving…' : 'Save profile'}</Button>
          </form>
        </section>
        <section className='account-card' aria-labelledby='password-heading'>
          <h2 id='password-heading'><LockKey size={24} />Password</h2>
          {user.demo || user.hasLocalPassword ? <>
            <p className='account-help'>Change the password you use to sign in with your email. You will be signed out on all devices, including this one, after saving.</p>
            {user.external_id && <p className='account-help'>This changes your platform password only. Your Microsoft password is managed by your organisation.</p>}
            <form onSubmit={changePassword}>
              <input type='hidden' name='username' value={user.email} autoComplete='username' />
              <Field label='Current password'><input name='currentPassword' type='password' autoComplete='current-password' required maxLength={200} disabled={user.demo || Boolean(busy)} /></Field>
              <Field label='New password' hint={passwordHint}><input name='newPassword' type='password' {...newPasswordProps} required disabled={user.demo || Boolean(busy)} /></Field>
              <Field label='Confirm new password'><input name='confirmPassword' type='password' {...newPasswordProps} required disabled={user.demo || Boolean(busy)} /></Field>
              {passwordError && <p className='account-error' role='alert'>{passwordError}</p>}
              <Button primary disabled={user.demo || Boolean(busy)}>{busy === 'password' ? 'Changing password…' : 'Change password and sign out'}</Button>
            </form>
          </> : <div className='notice'>{user.external_id ? 'You sign in with Microsoft 365. Your password is managed by Microsoft or your organisation. Use your Microsoft account settings or contact your IT administrator to change it.' : 'This account has no local password. Contact your administrator for help with your sign-in method.'}</div>}
        </section>
      </div>
      <aside className='account-card account-access' aria-labelledby='access-heading'>
        <h2 id='access-heading'><ShieldCheck size={24} />Workspace access</h2>
        <dl><dt>Company</dt><dd>{user.organization}</dd><dt>Roles</dt><dd>{user.roles.map(r => r.replaceAll('_', ' ').toLowerCase()).join(', ')}</dd><dt>Teams & departments</dt><dd>{units.filter(u => user.unit_ids.includes(u.id)).map(u => u.name).join(', ') || 'Own meetings only'}</dd><dt>Sign-in method</dt><dd>{user.demo ? 'Sample workspace' : [user.hasLocalPassword && 'Email and password', user.external_id && 'Microsoft 365'].filter(Boolean).join(' · ') || 'Contact your administrator'}</dd></dl>
        <p className='account-help'>Another administrator must change your roles or access. This prevents you from accidentally removing your own access.</p>
      </aside>
    </div>
  </section>;
}
