import { requireSupabase } from './supabase';
import type { Profile } from './auth';
import { splitCentsEvenly } from './money';

// One ledger entry = one bill as it concerns ONE other person.
// directionCents is signed from the current user's point of view:
//   positive -> they owe you (you paid the bill)
//   negative -> you owe them (they paid the bill)
// Net balance with a person = sum of directionCents over all shared bills.
export type LedgerEntry = {
  billId: string;
  description: string;
  totalCents: number;
  createdAt: string;
  otherUserId: string;
  directionCents: number;
};

// A connection as seen from the current user's side (journal item 4: these
// start life as pending friend requests and only count once accepted).
export type Connection = {
  id: string;
  status: 'pending' | 'accepted';
  requestedByMe: boolean;
  profile: Profile; // the person on the other end
};

export type PersonBalance = {
  profile: Profile;
  netCents: number;
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type ProfileRow = { id: string; username: string; display_name: string };

function rowToProfile(row: ProfileRow): Profile {
  return { id: row.id, username: row.username, displayName: row.display_name };
}

// Every connection the user is on either end of — accepted friendships plus
// pending requests in both directions. A row stores the pair as
// (user_a = requester, user_b = recipient); we join profiles on both sides
// and return whichever side isn't the current user.
export async function fetchConnections(userId: string): Promise<Connection[]> {
  const { data, error } = await requireSupabase()
    .from('connections')
    .select(
      `id, user_a, user_b, status,
       a:profiles!connections_user_a_fkey (id, username, display_name),
       b:profiles!connections_user_b_fkey (id, username, display_name)`,
    )
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  type Row = {
    id: string;
    user_a: string;
    user_b: string;
    status: 'pending' | 'accepted';
    a: ProfileRow;
    b: ProfileRow;
  };
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    status: row.status,
    requestedByMe: row.user_a === userId,
    profile: rowToProfile(row.user_a === userId ? row.b : row.a),
  }));
}

// The user's full ledger, as two queries:
//   1. bills the user PAID, with every share owed to them
//   2. shares the user OWES on other people's bills
// Balances are then a pure client-side fold over the entries — the database
// stays the single source of truth (bills + shares), and balances can never
// drift out of sync because they're recomputed from it every time.
export async function fetchLedger(userId: string): Promise<LedgerEntry[]> {
  const sb = requireSupabase();

  const [paidResult, owedResult] = await Promise.all([
    sb
      .from('bills')
      .select(
        'id, description, total_amount_cents, created_at, bill_shares (user_id, amount_owed_cents)',
      )
      .eq('created_by', userId),
    sb
      .from('bill_shares')
      .select(
        'amount_owed_cents, bill:bills!inner (id, created_by, description, total_amount_cents, created_at)',
      )
      .eq('user_id', userId),
  ]);
  if (paidResult.error) throw new Error(paidResult.error.message);
  if (owedResult.error) throw new Error(owedResult.error.message);

  type PaidRow = {
    id: string;
    description: string;
    total_amount_cents: number;
    created_at: string;
    bill_shares: { user_id: string; amount_owed_cents: number }[];
  };
  type OwedRow = {
    amount_owed_cents: number;
    bill: {
      id: string;
      created_by: string;
      description: string;
      total_amount_cents: number;
      created_at: string;
    };
  };

  const entries: LedgerEntry[] = [];

  for (const bill of (paidResult.data ?? []) as unknown as PaidRow[]) {
    for (const share of bill.bill_shares) {
      entries.push({
        billId: bill.id,
        description: bill.description,
        totalCents: bill.total_amount_cents,
        createdAt: bill.created_at,
        otherUserId: share.user_id,
        directionCents: share.amount_owed_cents,
      });
    }
  }
  for (const share of (owedResult.data ?? []) as unknown as OwedRow[]) {
    entries.push({
      billId: share.bill.id,
      description: share.bill.description,
      totalCents: share.bill.total_amount_cents,
      createdAt: share.bill.created_at,
      otherUserId: share.bill.created_by,
      directionCents: -share.amount_owed_cents,
    });
  }

  // Newest first, ready for the transaction lists.
  entries.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  return entries;
}

export function computeBalances(
  people: Profile[],
  ledger: LedgerEntry[],
): PersonBalance[] {
  const netByUser = new Map<string, number>();
  for (const entry of ledger) {
    netByUser.set(
      entry.otherUserId,
      (netByUser.get(entry.otherUserId) ?? 0) + entry.directionCents,
    );
  }
  return people.map((profile) => ({
    profile,
    netCents: netByUser.get(profile.id) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

// Sends a friend request (the row starts 'pending'; the other person accepts
// it from their home page).
export async function sendRequest(
  userId: string,
  rawUsername: string,
): Promise<string | null> {
  const username = rawUsername.trim().toLowerCase();
  if (!username) return 'Enter a username';
  const sb = requireSupabase();
  const { data: person } = await sb
    .from('profiles')
    .select('id, username, display_name')
    .eq('username', username)
    .maybeSingle();
  if (!person) return `No Splitly user named “${username}” — invite them instead`;
  if ((person as ProfileRow).id === userId) return "That's you — add someone else";
  const { error } = await sb
    .from('connections')
    .insert({ user_a: userId, user_b: (person as ProfileRow).id });
  if (error) {
    // 23505 = Postgres unique_violation: the pair index caught a duplicate.
    return error.code === '23505'
      ? 'Already added or requested'
      : error.message;
  }
  return null;
}

export async function acceptRequest(connectionId: string): Promise<string | null> {
  const { error } = await requireSupabase()
    .from('connections')
    .update({ status: 'accepted' })
    .eq('id', connectionId);
  return error ? error.message : null;
}

// Declining (recipient) and cancelling (requester) are both just deletion.
export async function removeConnection(connectionId: string): Promise<string | null> {
  const { error } = await requireSupabase()
    .from('connections')
    .delete()
    .eq('id', connectionId);
  return error ? error.message : null;
}

export type NewBill = {
  description: string;
  totalCents: number;
  participantIds: string[];
  splitType: 'even' | 'full_price';
  includeSelf: boolean;
};

// Computes each participant's share, then calls the create_bill RPC, which
// inserts the bill and all shares in a single database transaction.
export async function createBill(bill: NewBill): Promise<string | null> {
  const { description, totalCents, participantIds, splitType, includeSelf } = bill;
  if (!description.trim()) return 'Enter what the bill was for';
  if (totalCents <= 0) return 'Enter an amount';
  if (participantIds.length === 0) return 'Select at least one person';

  let amounts: number[];
  if (splitType === 'even') {
    // "Include yourself" adds the payer as one more head in the divisor, but
    // the payer never owes themselves — so the shares list is computed over
    // n heads and the payer's own share (the first slot, which absorbs any
    // leftover cent) is simply dropped.
    const heads = participantIds.length + (includeSelf ? 1 : 0);
    const parts = splitCentsEvenly(totalCents, heads);
    amounts = includeSelf ? parts.slice(1) : parts;
  } else {
    // Full price: each selected person owes the full amount (e.g. you bought
    // a $50 ticket for each of them).
    amounts = participantIds.map(() => totalCents);
  }

  const { error } = await requireSupabase().rpc('create_bill', {
    p_description: description.trim(),
    p_total_cents: totalCents,
    p_split_type: splitType,
    p_include_self: includeSelf,
    p_share_user_ids: participantIds,
    p_share_amounts_cents: amounts,
  });
  return error ? error.message : null;
}
