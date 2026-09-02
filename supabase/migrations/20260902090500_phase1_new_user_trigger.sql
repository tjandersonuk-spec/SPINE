-- Phase 1 — turn a new auth user into a person.
--
-- Supabase Auth writes auth.users; nothing writes public.profiles. Without this
-- trigger a signed-up person has no profile, so profiles_select matches nothing,
-- accept_invitation() finds no address to compare, and the landing page shows a
-- signed-in stranger with no name. The profile is the person; it must exist from
-- the moment the login does.
--
-- SECURITY DEFINER because the row is inserted before the new user has any
-- session to be authorised by. It runs on every sign-up and takes no input it
-- does not get from Auth itself.

create or replace function handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    -- the name the sign-up form passed, else something usable rather than blank
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
             split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Keep the profile's address in step if it is ever changed through Auth. The
-- column is not writable by the person themselves (see the grants migration);
-- this is the only path by which it changes, and only after Auth has proved it.
create or replace function handle_user_email_change()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function handle_user_email_change();
