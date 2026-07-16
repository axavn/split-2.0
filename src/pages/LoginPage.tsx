import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { useAuth, USERNAME_RULES } from '../lib/auth';

// Spec §3: centered both ways, big SPLITLY wordmark above username/password,
// with a low-friction "Create account" link that flips the same form into
// sign-up mode. 2.1: sign-up also collects first + last name, which become
// the display name (username stays the unique login handle).
export function LoginPage() {
  const { session, loading, signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <div className="splash">SPLITLY</div>;
  // Session persists in localStorage, so returning users skip login entirely.
  if (session) return <Navigate to="/" replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const failure =
      mode === 'login'
        ? await signIn(username, password)
        : await signUp(username, password, `${firstName.trim()} ${lastName.trim()}`.trim());
    setBusy(false);
    if (failure) {
      setError(failure);
    } else {
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="login">
      <h1 className="login__wordmark">SPLITLY</h1>

      <form className="login__form" onSubmit={handleSubmit}>
        {mode === 'signup' && (
          <div className="name-row">
            <input
              className="field"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              placeholder="First name"
              aria-label="First name"
              autoComplete="given-name"
            />
            <input
              className="field"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              placeholder="Last name"
              aria-label="Last name"
              autoComplete="family-name"
            />
          </div>
        )}
        <input
          className="field"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          aria-label="Username"
          autoComplete="username"
          autoCapitalize="none"
        />
        <input
          className="field"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          aria-label="Password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
        {mode === 'signup' && <p className="muted">Username: {USERNAME_RULES}</p>}
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn--primary btn--full" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
      </form>

      <button
        type="button"
        className="login__toggle"
        onClick={() => {
          setMode((current) => (current === 'login' ? 'signup' : 'login'));
          setError(null);
        }}>
        {mode === 'login' ? 'Create account' : 'Have an account? Log in'}
      </button>
    </div>
  );
}
