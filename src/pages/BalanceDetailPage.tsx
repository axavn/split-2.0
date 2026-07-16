import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useAuth, type Profile } from '../lib/auth';
import { fetchLedger, fetchPeople, type LedgerEntry } from '../lib/data';
import { formatCents, formatDate } from '../lib/money';
import { useInfiniteList } from '../lib/useInfiniteList';

// Spec §6: the other person's name top right, a "You owe / You collect" line,
// a static green/red balance pill, then every shared transaction newest-first.
export function BalanceDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { session } = useAuth();

  const [person, setPerson] = useState<Profile | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !userId) return;
    let cancelled = false;
    Promise.all([fetchPeople(session.user.id), fetchLedger(session.user.id)])
      .then(([people, ledger]) => {
        if (cancelled) return;
        setPerson(people.find((p) => p.id === userId) ?? null);
        setEntries(ledger.filter((entry) => entry.otherUserId === userId));
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session, userId]);

  const { visible, hasMore, sentinelRef } = useInfiniteList(entries ?? []);
  const netCents = (entries ?? []).reduce((sum, entry) => sum + entry.directionCents, 0);

  if (error) return <p className="error-text page">{error}</p>;
  if (!entries) return <p className="muted page">Loading…</p>;

  return (
    <div className="page">
      <p className="detail__name">{person?.username ?? 'Unknown'}</p>

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
                {entry.directionCents >= 0 ? 'You paid' : 'They paid'} ·{' '}
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
          </div>
        ))}
        {hasMore && <div ref={sentinelRef} className="sentinel" aria-hidden="true" />}
      </div>
    </div>
  );
}
