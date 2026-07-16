import { useState, type FormEvent } from 'react';

import { useAuth } from '../lib/auth';
import { sendRequest } from '../lib/data';

// Spec §7.3, revised in 2.1 (journal item 4): entering a username now sends a
// friend request; the shared balance only exists once the other person
// accepts it from their home page.
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
    const failure = await sendRequest(session.user.id, username);
    setBusy(false);
    if (failure) {
      setMessage({ kind: 'err', text: failure });
    } else {
      setMessage({
        kind: 'ok',
        text: `Request sent to ${username.trim().toLowerCase()} — once they accept, they'll appear on your home page`,
      });
      setUsername('');
    }
  };

  const copyInvite = async () => {
    // The invite is just the site link — a new user creates an account, then
    // either side sends the other a request by username.
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
          {busy ? '…' : 'Send request'}
        </button>
      </form>

      <div className="card stack">
        <p className="muted">
          Don't see them on Splitly? Send them an invite link — once they sign
          up, request them here by username.
        </p>
        <button type="button" className="btn btn--full" onClick={copyInvite}>
          {copied ? 'Copied!' : 'Copy invite link'}
        </button>
      </div>
    </div>
  );
}
