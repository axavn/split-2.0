-- ============================================================================
-- Splitly 2.1 migration — run once in: Dashboard -> SQL Editor -> paste -> Run.
-- (schema.sql is updated with the same end-state for fresh installs.)
--
-- Adds:
--   1. profiles.display_name — unique username stays for login/adding people;
--      display name is what everyone sees ("alexngvn" vs "Alex Nguyen").
--   2. connections.status — friend-request flow. New connections start
--      'pending' and only count once the recipient accepts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Display names
-- ---------------------------------------------------------------------------
alter table public.profiles add column display_name text;

-- Existing accounts: fall back to the username until they set a real name.
update public.profiles set display_name = username where display_name is null;

alter table public.profiles alter column display_name set not null;

-- New signups now carry display_name in the auth metadata; keep falling back
-- to the username if it's ever missing/blank.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'username',
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      new.raw_user_meta_data ->> 'username'
    )
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Friend requests
-- ---------------------------------------------------------------------------
-- Adding the column with default 'accepted' stamps every EXISTING row as
-- accepted (grandfathered in) ...
alter table public.connections add column status text not null default 'accepted'
  check (status in ('pending', 'accepted'));

-- ... then new rows default to 'pending' from here on.
alter table public.connections alter column status set default 'pending';

-- The recipient (user_b — requests are inserted with user_a = requester) may
-- update the row, which is how accepting works.
create policy "recipient can accept a request"
  on public.connections for update
  to authenticated
  using (user_b = (select auth.uid()))
  with check (user_b = (select auth.uid()));

-- Either side may delete: recipient declining, or requester cancelling.
create policy "either side can remove a connection"
  on public.connections for delete
  to authenticated
  using (user_a = (select auth.uid()) or user_b = (select auth.uid()));
