import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../lib/auth';
import { computeBalances, fetchLedger, fetchPeople, type PersonBalance } from '../lib/data';
import { formatCents } from '../lib/money';
import { useInfiniteList } from '../lib/useInfiniteList';

type Filter = 'all' | 'owe' | 'collect';

// Spec §5: "Welcome [username]" top right, Owe/Collect/All filter pills, then
// an infinitely-scrolling list of long pressable person buttons.
export function HomePage() {
  const { session, profile } = useAuth();
  const navigate = useNavigate();

  const [balances, setBalances] = useState<PersonBalance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    Promise.all([fetchPeople(session.user.id), fetchLedger(session.user.id)])
      .then(([people, ledger]) => {
        if (!cancelled) setBalances(computeBalances(people, ledger));
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const filtered = (balances ?? []).filter((balance) =>
    filter === 'owe'
      ? balance.netCents < 0
      : filter === 'collect'
        ? balance.netCents > 0
        : true,
  );
  const { visible, hasMore, sentinelRef } = useInfiniteList(filtered);

  const filterButton = (value: Filter, label: string) => (
    <button
      type="button"
      className={`filter-pill${filter === value ? ' filter-pill--active' : ''}`}
      onClick={() => setFilter(value)}>
      {label}
    </button>
  );

  return (
    <div className="page">
      <p className="welcome-line">Welcome {profile?.username ?? '…'}</p>

      <div className="filters">
        {filterButton('owe', 'Owe')}
        {filterButton('collect', 'Collect')}
        {filterButton('all', 'All')}
      </div>

      {error && <p className="error-text">{error}</p>}
      {!balances && !error && <p className="muted">Loading…</p>}

      {balances && balances.length === 0 && (
        <p className="empty">
          Nobody here yet. <Link to="/add/person">Add a person</Link> to start
          splitting bills.
        </p>
      )}
      {balances && balances.length > 0 && filtered.length === 0 && (
        <p className="empty">
          {filter === 'owe' ? 'You owe nobody. Nice.' : 'Nothing to collect right now.'}
        </p>
      )}

      <div className="stack">
        {visible.map(({ profile: person, netCents }) => (
          <button
            key={person.id}
            type="button"
            className="person-button"
            onClick={() => navigate(`/person/${person.id}`)}>
            <span className="person-button__avatar" aria-hidden="true">
              {person.username[0]?.toUpperCase()}
            </span>
            <span className="person-button__right">
              <span className="person-button__name">{person.username}</span>
              <span
                className={`person-button__balance ${
                  netCents > 0
                    ? 'amount--positive'
                    : netCents < 0
                      ? 'amount--negative'
                      : 'amount--neutral'
                }`}>
                {netCents > 0
                  ? `Collect ${formatCents(netCents)}`
                  : netCents < 0
                    ? `You owe ${formatCents(-netCents)}`
                    : 'Settled up'}
              </span>
            </span>
          </button>
        ))}
        {hasMore && <div ref={sentinelRef} className="sentinel" aria-hidden="true" />}
      </div>
    </div>
  );
}
