import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useAuth } from '../lib/auth';
import {
  acceptRequest,
  computeBalances,
  fetchConnections,
  fetchLedger,
  removeConnection,
  type Connection,
  type LedgerEntry,
} from '../lib/data';
import { formatCents } from '../lib/money';
import { useInfiniteList } from '../lib/useInfiniteList';

type Filter = 'all' | 'owe' | 'collect';

// Spec §5: "Welcome …" top right, Owe/Collect/All filter pills, infinite
// person list. 2.1: incoming friend requests to accept/decline sit above the
// list, and each row shows just a big green/red amount (journal item 6).
export function HomePage() {
  const { session, profile } = useAuth();
  const navigate = useNavigate();

  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const refresh = useCallback(() => {
    if (!session) return () => {};
    let cancelled = false;
    Promise.all([fetchConnections(session.user.id), fetchLedger(session.user.id)])
      .then(([nextConnections, nextLedger]) => {
        if (cancelled) return;
        setConnections(nextConnections);
        setLedger(nextLedger);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => refresh(), [refresh]);

  const incoming = (connections ?? []).filter(
    (c) => c.status === 'pending' && !c.requestedByMe,
  );
  const outgoing = (connections ?? []).filter(
    (c) => c.status === 'pending' && c.requestedByMe,
  );
  const accepted = (connections ?? []).filter((c) => c.status === 'accepted');

  const balances = computeBalances(
    accepted.map((c) => c.profile),
    ledger ?? [],
  );
  const filtered = balances.filter((balance) =>
    filter === 'owe'
      ? balance.netCents < 0
      : filter === 'collect'
        ? balance.netCents > 0
        : true,
  );
  const { visible, hasMore, sentinelRef } = useInfiniteList(filtered);

  const handleAccept = async (connectionId: string) => {
    const failure = await acceptRequest(connectionId);
    if (failure) setError(failure);
    else refresh();
  };

  const handleDecline = async (connectionId: string) => {
    const failure = await removeConnection(connectionId);
    if (failure) setError(failure);
    else refresh();
  };

  const filterButton = (value: Filter, label: string) => (
    <button
      type="button"
      className={`filter-pill${filter === value ? ' filter-pill--active' : ''}`}
      onClick={() => setFilter(value)}>
      {label}
    </button>
  );

  const loadingData = !connections || !ledger;

  return (
    <div className="page">
      <p className="welcome-line">Welcome {profile?.displayName ?? '…'}</p>

      <div className="filters">
        {filterButton('owe', 'Owe')}
        {filterButton('collect', 'Collect')}
        {filterButton('all', 'All')}
      </div>

      {error && <p className="error-text">{error}</p>}
      {loadingData && !error && <p className="muted">Loading…</p>}

      {incoming.length > 0 && (
        <div className="requests">
          <p className="requests__title">Requests</p>
          {incoming.map((request) => (
            <div key={request.id} className="requests__row">
              <span className="requests__who">
                {request.profile.displayName}
                <span className="requests__username"> @{request.profile.username}</span>
              </span>
              <span className="requests__actions">
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  onClick={() => handleAccept(request.id)}>
                  Accept
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => handleDecline(request.id)}>
                  Decline
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {outgoing.length > 0 && (
        <p className="muted requests__outgoing">
          Waiting on: {outgoing.map((c) => c.profile.displayName).join(', ')}
        </p>
      )}

      {!loadingData && accepted.length === 0 && incoming.length === 0 && (
        <p className="empty">
          Nobody here yet. <Link to="/add/person">Add a person</Link> to start
          splitting bills.
        </p>
      )}
      {!loadingData && accepted.length > 0 && filtered.length === 0 && (
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
            <span className="person-button__names">
              <span className="person-button__name">{person.displayName}</span>
              <span className="person-button__username">@{person.username}</span>
            </span>
            {/* Journal item 6: no "owe"/"collect" words — just a big number,
                green when they owe you, red when you owe them. */}
            <span
              className={`person-button__balance ${
                netCents > 0
                  ? 'amount--positive'
                  : netCents < 0
                    ? 'amount--negative'
                    : 'amount--neutral'
              }`}>
              {formatCents(Math.abs(netCents))}
            </span>
          </button>
        ))}
        {hasMore && <div ref={sentinelRef} className="sentinel" aria-hidden="true" />}
      </div>
    </div>
  );
}
