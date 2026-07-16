-- ============================================================================
-- FIX: infinite recursion between the bills and bill_shares RLS policies.
--
-- The original policies were mutually referential: reading `bills` evaluated
-- a subquery on `bill_shares` (is the viewer a participant?), and reading
-- `bill_shares` evaluated a subquery on `bills` (is the viewer the payer?).
-- Postgres applies RLS to the subqueries too, so each policy re-triggered
-- the other — infinite recursion.
--
-- The standard fix: move those checks into SECURITY DEFINER functions. They
-- execute as the function owner, and table owners bypass RLS, so the lookup
-- inside the function doesn't re-enter the policy machinery. The functions
-- expose only a boolean answer, so no data leaks.
--
-- Run this once in: Dashboard -> SQL Editor -> paste -> Run.
-- (Already merged into schema.sql for fresh installs.)
-- ============================================================================

create or replace function public.is_bill_payer(p_bill_id uuid, p_user uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.bills b
    where b.id = p_bill_id and b.created_by = p_user
  );
$$;

create or replace function public.is_bill_participant(p_bill_id uuid, p_user uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.bill_shares s
    where s.bill_id = p_bill_id and s.user_id = p_user
  );
$$;

revoke all on function public.is_bill_payer(uuid, uuid) from public, anon;
grant execute on function public.is_bill_payer(uuid, uuid) to authenticated;
revoke all on function public.is_bill_participant(uuid, uuid) from public, anon;
grant execute on function public.is_bill_participant(uuid, uuid) to authenticated;

drop policy "payer and participants see a bill" on public.bills;
create policy "payer and participants see a bill"
  on public.bills for select
  to authenticated
  using (
    created_by = (select auth.uid())
    or public.is_bill_participant(id, (select auth.uid()))
  );

drop policy "bill items follow bill visibility" on public.bill_items;
create policy "bill items follow bill visibility"
  on public.bill_items for select
  to authenticated
  using (
    public.is_bill_payer(bill_id, (select auth.uid()))
    or public.is_bill_participant(bill_id, (select auth.uid()))
  );

drop policy "payer inserts bill items" on public.bill_items;
create policy "payer inserts bill items"
  on public.bill_items for insert
  to authenticated
  with check (public.is_bill_payer(bill_id, (select auth.uid())));

drop policy "users see shares involving them" on public.bill_shares;
create policy "users see shares involving them"
  on public.bill_shares for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_bill_payer(bill_id, (select auth.uid()))
  );

drop policy "payer inserts shares for their bill" on public.bill_shares;
create policy "payer inserts shares for their bill"
  on public.bill_shares for insert
  to authenticated
  with check (public.is_bill_payer(bill_id, (select auth.uid())));
