import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth, USERNAME_RULES } from '../lib/auth';

type Msg = { kind: 'ok' | 'err'; text: string } | null;

// Spec §8, extended in 2.1: editable display name (journal item 3) and the
// standard old / new / confirm password flow (journal item 5).
export function AccountPage() {
  const { profile, updateUsername, updateDisplayName, changePassword, signOut } =
    useAuth();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [displayMsg, setDisplayMsg] = useState<Msg>(null);
  const [nameMsg, setNameMsg] = useState<Msg>(null);
  const [passMsg, setPassMsg] = useState<Msg>(null);

  const handleDisplayName = async (event: FormEvent) => {
    event.preventDefault();
    setDisplayMsg(null);
    const failure = await updateDisplayName(displayName);
    setDisplayMsg(
      failure ? { kind: 'err', text: failure } : { kind: 'ok', text: 'Name updated' },
    );
  };

  const handleUsername = async (event: FormEvent) => {
    event.preventDefault();
    setNameMsg(null);
    const failure = await updateUsername(username);
    setNameMsg(
      failure
        ? { kind: 'err', text: failure }
        : { kind: 'ok', text: 'Username updated' },
    );
  };

  const handlePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPassMsg(null);
    // Confirm-new is a pure client-side check: its only job is catching typos
    // before anything hits the server.
    if (newPassword !== confirmPassword) {
      setPassMsg({ kind: 'err', text: "New passwords don't match" });
      return;
    }
    const failure = await changePassword(oldPassword, newPassword);
    if (!failure) {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
    setPassMsg(
      failure
        ? { kind: 'err', text: failure }
        : { kind: 'ok', text: 'Password changed' },
    );
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="page">
      <h1 className="page__title">Account</h1>

      <form className="card stack" onSubmit={handleDisplayName}>
        <p className="field-label">Display name</p>
        <input
          className="field"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          aria-label="Display name"
          autoComplete="name"
        />
        <p className="muted">What other people see. Your username stays the same.</p>
        {displayMsg && (
          <p className={displayMsg.kind === 'ok' ? 'success-text' : 'error-text'}>
            {displayMsg.text}
          </p>
        )}
        <button type="submit" className="btn btn--full">
          Save name
        </button>
      </form>

      <form className="card stack" onSubmit={handleUsername}>
        <p className="field-label">Username</p>
        <input
          className="field"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          aria-label="Username"
          autoCapitalize="none"
        />
        <p className="muted">{USERNAME_RULES}. Changing it also changes how you log in.</p>
        {nameMsg && (
          <p className={nameMsg.kind === 'ok' ? 'success-text' : 'error-text'}>
            {nameMsg.text}
          </p>
        )}
        <button type="submit" className="btn btn--full">
          Save username
        </button>
      </form>

      <form className="card stack" onSubmit={handlePassword}>
        <p className="field-label">Change password</p>
        <input
          className="field"
          type="password"
          value={oldPassword}
          onChange={(event) => setOldPassword(event.target.value)}
          placeholder="Enter old password"
          aria-label="Old password"
          autoComplete="current-password"
        />
        <input
          className="field"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="Enter new password"
          aria-label="New password"
          autoComplete="new-password"
        />
        <input
          className="field"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Confirm new password"
          aria-label="Confirm new password"
          autoComplete="new-password"
        />
        {passMsg && (
          <p className={passMsg.kind === 'ok' ? 'success-text' : 'error-text'}>
            {passMsg.text}
          </p>
        )}
        <button
          type="submit"
          className="btn btn--full"
          disabled={!oldPassword || !newPassword || !confirmPassword}>
          Save password
        </button>
      </form>

      <button type="button" className="btn btn--danger btn--full" onClick={handleLogout}>
        Log out
      </button>
    </div>
  );
}
