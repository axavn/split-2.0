import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth, USERNAME_RULES } from '../lib/auth';

// Spec §8: simple layout — editable username, change password, log out.
export function AccountPage() {
  const { profile, updateUsername, changePassword, signOut } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState(profile?.username ?? '');
  const [password, setPassword] = useState('');
  const [nameMsg, setNameMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [passMsg, setPassMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

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
    const failure = await changePassword(password);
    if (!failure) setPassword('');
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
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="New password"
          aria-label="New password"
          autoComplete="new-password"
        />
        {passMsg && (
          <p className={passMsg.kind === 'ok' ? 'success-text' : 'error-text'}>
            {passMsg.text}
          </p>
        )}
        <button type="submit" className="btn btn--full" disabled={password.length === 0}>
          Save password
        </button>
      </form>

      <button type="button" className="btn btn--danger btn--full" onClick={handleLogout}>
        Log out
      </button>
    </div>
  );
}
