import { useState, type FormEvent } from 'react';

import { useAuth } from '../lib/auth';
import { addPerson } from '../lib/data';

// Spec §7.3: add an existing Splitly user by exact username, or copy an
// invite link for someone who doesn't have an account yet.
export function AddPersonPage() {
  const { session } = useAuth();
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!session) return;
    setBusy(true);
    setMessage(null);
    const failure = await addPerson(session.user.id, username);
    setBusy(false);
    if (failure) {
      setMessage({ kind: 'err', text: failure });
    } else {
      setMessage({
        kind: 'ok',
        text: `Added ${username.trim().toLowerCase()} — they're on your home page at $0.00`,
      });
      setUsername('');
    }
  };

  const copyInvite = async () => {
    // The invite is just the site link — a new user creates an account, then
    // either side adds the other by username.
    await navigator.clipboard.writeText(
      `Join me on Splitly so we can split bills: ${window.location.origin}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="page">
      <h1 className="page__title">Add Person</h1>

      <form className="stack" onSubmit={handleSubmit}>
        <input
          className="field"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Their exact username"
          aria-label="Username to add"
          autoCapitalize="none"
        />
        {message && (
          <p className={message.kind === 'ok' ? 'success-text' : 'error-text'}>
            {message.text}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--full" disabled={busy}>
          {busy ? '…' : 'Add person'}
        </button>
      </form>

      <div className="card stack">
        <p className="muted">
          Don't see them on Splitly? Send them an invite link — once they sign
          up, add them here by username.
        </p>
        <button type="button" className="btn btn--full" onClick={copyInvite}>
          {copied ? 'Copied!' : 'Copy invite link'}
        </button>
      </div>
    </div>
  );
}
