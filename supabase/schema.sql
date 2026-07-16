-- ============================================================================
-- Split 2.0 database schema (spec §10)
-- Run this once in your Supabase project: Dashboard -> SQL Editor -> paste -> Run.
--
-- Design decisions:
--  * All money columns store INTEGER CENTS, never floats. Floating point can't
--    represent 0.10 exactly, so financial code that uses floats accumulates
--    rounding bugs. The UI only accepts whole dollars (spec §7.1), which we
--    multiply by 100 on the way in.
--  * Balances are DERIVED, never stored. The net balance between two users is
--    computed from bill_shares rows. Storing a running balance would create a
--    second source of truth that could drift from the bills that produced it.
--  * Row Level Security (RLS) does the real access control. The browser talks
--    to Postgres with the public "anon" key, so every table must have policies
--    saying who may read/write which rows; without them, anyone could read
--    everyone's data.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user. Supabase Auth owns auth.users (email +
-- password); this table holds the public-facing identity (username).
-- The UI logs in with username; the client maps it to the synthetic email
-- "<username>@splitly.local" used at signup, per spec §2's note.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

-- Automatically create the profile row when a user signs up. The username
-- travels in auth metadata (options.data.username in the signUp call).
-- "security definer" runs the trigger as the function owner so it can insert
-- despite RLS.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- connections: "added people" — an edge between two users. One row per pair;
-- user_a is whoever added the connection. The check keeps a user from adding
-- themselves, and the unique index treats (a,b) and (b,a) as the same pair.
-- ---------------------------------------------------------------------------
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_a <> user_b)
);

create unique index connections_pair_unique
  on public.connections (least(user_a, user_b), greatest(user_a, user_b));

-- ---------------------------------------------------------------------------
-- bills: one row per confirmed bill. created_by is the payer.
-- total_amount_cents: integer cents (UI enforces whole dollars).
-- bill_items / receipt columns exist per spec §10 so the receipt-scan feature
-- can be added later without a migration.
-- ---------------------------------------------------------------------------
create table public.bills (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete cascade,
  description text not null,
  total_amount_cents integer not null check (total_amount_cents > 0),
  source text not null default 'manual' check (source in ('manual', 'receipt_scan')),
  split_type text not null check (split_type in ('even', 'full_price', 'by_item')),
  include_self boolean not null default false,
  receipt_image_url text,
  created_at timestamptz not null default now()
);

create table public.bill_items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  item_name text not null,
  price_cents integer not null check (price_cents >= 0)
);

-- ---------------------------------------------------------------------------
-- bill_shares: one row per involved person per bill — what that person owes
-- the payer. The payer never has a share row for their own bill (their own
-- portion of a split isn't a debt).
--
-- Net balance between X and Y (spec §10):
--   sum(shares Y owes on bills X paid) - sum(shares X owes on bills Y paid)
--   positive -> Y owes X ("Collect", green); negative -> X owes Y ("Owe", red)
-- ---------------------------------------------------------------------------
create table public.bill_shares (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  bill_item_id uuid references public.bill_items (id) on delete set null,
  amount_owed_cents integer not null check (amount_owed_cents >= 0)
);

create index bill_shares_bill_id_idx on public.bill_shares (bill_id);
create index bill_shares_user_id_idx on public.bill_shares (user_id);
create index bills_created_by_idx on public.bills (created_by);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.connections enable row level security;
alter table public.bills enable row level security;
alter table public.bill_items enable row level security;
alter table public.bill_shares enable row level security;

-- profiles: any signed-in user may read profiles (needed to search usernames
-- when adding a person, and to show names on bills). Only you can update yours.
create policy "profiles are readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- connections: visible to either side of the edge; created by the adder.
create policy "users see their own connections"
  on public.connections for select
  to authenticated
  using (user_a = (select auth.uid()) or user_b = (select auth.uid()));

create policy "users add connections as themselves"
  on public.connections for insert
  to authenticated
  with check (user_a = (select auth.uid()));

-- bills: visible to the payer and to anyone with a share on the bill.
create policy "payer and participants see a bill"
  on public.bills for select
  to authenticated
  using (
    created_by = (select auth.uid())
    or exists (
      select 1 from public.bill_shares s
      where s.bill_id = bills.id and s.user_id = (select auth.uid())
    )
  );

create policy "users create bills as themselves"
  on public.bills for insert
  to authenticated
  with check (created_by = (select auth.uid()));

-- bill_items: same visibility as the parent bill; only the payer writes them.
create policy "bill items follow bill visibility"
  on public.bill_items for select
  to authenticated
  using (
    exists (
      select 1 from public.bills b
      where b.id = bill_items.bill_id
        and (
          b.created_by = (select auth.uid())
          or exists (
            select 1 from public.bill_shares s
            where s.bill_id = b.id and s.user_id = (select auth.uid())
          )
        )
    )
  );

create policy "payer inserts bill items"
  on public.bill_items for insert
  to authenticated
  with check (
    exists (
      select 1 from public.bills b
      where b.id = bill_items.bill_id and b.created_by = (select auth.uid())
    )
  );

-- bill_shares: you see shares you owe, plus all shares on bills you paid;
-- only the bill's payer can create shares (normally via create_bill below).
create policy "users see shares involving them"
  on public.bill_shares for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.bills b
      where b.id = bill_shares.bill_id and b.created_by = (select auth.uid())
    )
  );

create policy "payer inserts shares for their bill"
  on public.bill_shares for insert
  to authenticated
  with check (
    exists (
      select 1 from public.bills b
      where b.id = bill_shares.bill_id and b.created_by = (select auth.uid())
    )
  );

-- ============================================================================
-- create_bill: insert a bill and all of its shares in ONE transaction.
--
-- Why an RPC instead of two inserts from the browser? If the client inserted
-- the bill, then failed (network drop, crash) before inserting the shares,
-- you'd have a bill that charges nobody — corrupt data. A Postgres function
-- runs atomically: either everything commits or nothing does.
--
-- "security invoker" (the default) means it runs AS the calling user, so all
-- the RLS policies above still apply — this function grants no extra power.
-- ============================================================================
create function public.create_bill(
  p_description text,
  p_total_cents integer,
  p_split_type text,
  p_include_self boolean,
  p_share_user_ids uuid[],
  p_share_amounts_cents integer[]
) returns uuid
language plpgsql
as $$
declare
  v_bill_id uuid;
  i integer;
begin
  if array_length(p_share_user_ids, 1) is distinct from array_length(p_share_amounts_cents, 1) then
    raise exception 'share user ids and amounts must have the same length';
  end if;

  insert into public.bills (created_by, description, total_amount_cents, split_type, include_self)
  values (auth.uid(), p_description, p_total_cents, p_split_type, p_include_self)
  returning id into v_bill_id;

  for i in 1 .. coalesce(array_length(p_share_user_ids, 1), 0) loop
    insert into public.bill_shares (bill_id, user_id, amount_owed_cents)
    values (v_bill_id, p_share_user_ids[i], p_share_amounts_cents[i]);
  end loop;

  return v_bill_id;
end;
$$;
