-- ============================================================================
-- Split 2.0 migration 2.2 — run once in: Dashboard -> SQL Editor -> paste -> Run.
-- (schema.sql is updated with the same end-state for fresh installs.)
--
-- Adds:
--   1. is_accepted_connection() + a create_bill check — a bill's participants
--      must be accepted connections of the caller. Previously create_bill
--      only checked "you're the payer"; nothing stopped a client from calling
--      the RPC directly with a stranger's user id and creating a debt they
--      never agreed to.
--   2. Delete policies on bills/bill_shares — bills are now hard-deletable by
--      their payer (there was no way to remove a mistaken bill before).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Connection check for create_bill
-- ---------------------------------------------------------------------------
create function public.is_accepted_connection(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.connections c
    where c.status = 'accepted'
      and ((c.user_a = p_user_a and c.user_b = p_user_b)
        or (c.user_a = p_user_b and c.user_b = p_user_a))
  );
$$;

revoke all on function public.is_accepted_connection(uuid, uuid) from public, anon;
grant execute on function public.is_accepted_connection(uuid, uuid) to authenticated;

create or replace function public.create_bill(
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

  for i in 1 .. coalesce(array_length(p_share_user_ids, 1), 0) loop
    if not public.is_accepted_connection(auth.uid(), p_share_user_ids[i]) then
      raise exception 'all bill participants must be accepted connections';
    end if;
  end loop;

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

-- ---------------------------------------------------------------------------
-- 2) Hard delete for bills, payer only
-- ---------------------------------------------------------------------------
create policy "payer deletes their own bill"
  on public.bills for delete
  to authenticated
  using (created_by = (select auth.uid()));

create policy "payer deletes shares on their bill"
  on public.bill_shares for delete
  to authenticated
  using (public.is_bill_payer(bill_id, (select auth.uid())));
