import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useAuth, type Profile } from '../lib/auth';
import {
  deleteBill,
  fetchConnections,
  fetchLedger,
  removeConnection,
  type LedgerEntry,
} from '../lib/data';
import { formatCents, formatDate } from '../lib/money';
import { useInfiniteList } from '../lib/useInfiniteList';

// Spec §6: the other person's name top right, a "You owe / You collect" line,
// a static green/red balance pill, then every shared transaction newest-first.
// 2.2: bills the current user paid can be deleted from here, and the
// connection itself can be removed once the balance is settled — see
// WALKTHROUGH §9.7.
export function BalanceDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { session } = useAuth();
  const navigate = useNavigate();

  const [person, setPerson] = useState<Profile | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!session || !userId) return;
    let cancelled = false;
    Promise.all([fetchConnections(session.user.id), fetchLedger(session.user.id)])
      .then(([connections, ledger]) => {
        if (cancelled) return;
        const connection = connections.find((c) => c.profile.id === userId) ?? null;
        setPerson(connection?.profile ?? null);
        setConnectionId(connection?.id ?? null);
        setEntries(ledger.filter((entry) => entry.otherUserId === userId));
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  };

  useEffect(load, [session, userId]);

  const { visible, hasMore, sentinelRef } = useInfiniteList(entries ?? []);
  const netCents = (entries ?? []).reduce((sum, entry) => sum + entry.directionCents, 0);

  const handleDeleteBill = async (billId: string, description: string) => {
    if (busy) return;
    if (!window.confirm(`Delete "${description}"? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    const failure = await deleteBill(billId);
    setBusy(false);
    if (failure) setError(failure);
    else load();
  };

  const handleRemoveConnection = async () => {
    if (!connectionId || busy) return;
    if (netCents !== 0) {
      setError(
        `Settle up with ${person?.displayName ?? 'this person'} before removing them — you still ${
          netCents > 0 ? 'collect' : 'owe'
        } ${formatCents(Math.abs(netCents))}.`,
      );
      return;
    }
    if (
      !window.confirm(`Remove ${person?.displayName ?? 'this person'}? You can re-add them later.`)
    )
      return;
    setBusy(true);
    setError(null);
    const failure = await removeConnection(connectionId);
    setBusy(false);
    if (failure) setError(failure);
    else navigate('/', { replace: true });
  };

  if (error && !entries) return <p className="error-text page">{error}</p>;
  if (!entries) return <p className="muted page">Loading…</p>;

  return (
    <div className="page">
      <p className="detail__name">{person?.displayName ?? 'Unknown'}</p>

      <p className="detail__direction">
        {netCents > 0 ? 'You collect…' : netCents < 0 ? 'You owe…' : 'All settled up'}
      </p>
      <div
        className={`balance-pill ${
          netCents > 0
            ? 'amount--positive'
            : netCents < 0
              ? 'amount--negative'
              : 'amount--neutral'
        }`}>
        {formatCents(Math.abs(netCents))}
      </div>

      {entries.length === 0 && (
        <p className="empty">No bills between you two yet.</p>
      )}

      <div className="stack">
        {visible.map((entry, index) => (
          <div key={`${entry.billId}-${index}`} className="txn">
            <span className="txn__main">
              <span className="txn__desc">{entry.description}</span>
              <span className="txn__meta">
                {entry.paidByMe ? 'You paid' : 'They paid'} ·{' '}
                {formatDate(entry.createdAt)} · bill total {formatCents(entry.totalCents)}
              </span>
            </span>
            <span
              className={`txn__amount ${
                entry.directionCents >= 0 ? 'amount--positive' : 'amount--negative'
              }`}>
              {entry.directionCents >= 0 ? '+' : '−'}
              {formatCents(Math.abs(entry.directionCents))}
            </span>
            {entry.paidByMe && (
              <button
                type="button"
                className="txn__delete"
                aria-label={`Delete ${entry.description}`}
                disabled={busy}
                onClick={() => handleDeleteBill(entry.billId, entry.description)}>
                ×
              </button>
            )}
          </div>
        ))}
        {hasMore && <div ref={sentinelRef} className="sentinel" aria-hidden="true" />}
      </div>

      {error && <p className="error-text detail__error">{error}</p>}

      {connectionId && (
        <button
          type="button"
          className="btn btn--full detail__remove"
          disabled={busy}
          onClick={handleRemoveConnection}>
          Remove connection
        </button>
      )}
    </div>
  );
}
