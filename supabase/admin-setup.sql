-- ============================================================
-- AVAILA ADMIN: database setup
-- ============================================================
-- Run this ONCE in the SQL Editor of the SAME Supabase project the Availa app uses.
-- It is safe to run again (idempotent).
--
-- What it does
--   1. Adds the admin role check:            public.is_admin()
--   2. Locks down who can change roles, suspension flags and verification/rating columns
--   3. Adds an audit log that records every admin change automatically
--   4. Gives admins (and ONLY admins) read access to cross-user data through views
--   5. Gives admins write access to the tables they moderate
--
-- It does NOT create the first admin. See the last section of this file.
-- It never touches auth.users and never drops data.
-- ============================================================

-- ------------------------------------------------------------
-- 0. COLUMNS THE ADMIN SITE NEEDS
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists is_deactivated   boolean not null default false,
  add column if not exists deactivated_at   timestamptz,
  add column if not exists avatar_url       text,
  add column if not exists is_suspended     boolean not null default false,
  add column if not exists suspended_at     timestamptz,
  add column if not exists suspended_reason text,
  add column if not exists suspended_by     uuid;

alter table public.user_reports
  add column if not exists ref_id        uuid not null default gen_random_uuid(),
  add column if not exists created_at    timestamptz not null default now(),
  add column if not exists status        text not null default 'open',
  add column if not exists admin_notes   text not null default '',
  add column if not exists resolved_by   uuid,
  add column if not exists resolved_at   timestamptz;

create unique index if not exists user_reports_ref_id_key on public.user_reports(ref_id);

do $$ begin
  alter table public.user_reports
    add constraint user_reports_status_chk check (status in ('open','investigating','actioned','dismissed'));
exception when duplicate_object then null; end $$;

alter table public.support_messages
  add column if not exists admin_notes text not null default '',
  add column if not exists resolved_at timestamptz,
  add column if not exists updated_at  timestamptz not null default now();

-- ------------------------------------------------------------
-- 1. WHO IS AN ADMIN
-- ------------------------------------------------------------
-- profiles.role already allows 'admin' (see nailbook.sql). Anyone whose profile says
-- role = 'admin' and who is not suspended counts as an admin.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'admin'
      and coalesce(p.is_suspended, false) = false
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------------------
-- 2. PROTECT SENSITIVE COLUMNS
-- ------------------------------------------------------------
-- The app grants every signed-in user UPDATE on their own profile row. Without this
-- trigger a user could set their own role to 'admin', or an artist could mark
-- themselves verified. Direct writes from the browser (role "authenticated"/"anon")
-- are blocked for these columns. Server code (service role), triggers owned by the
-- database, and the SQL Editor are not affected, so the app keeps working.
create or replace function public.protect_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_table_name = 'profiles' then
      -- Nobody can change a role from the browser, not even an admin.
      if new.role is distinct from old.role then
        raise exception 'Roles can only be changed by the database owner.' using errcode = '42501';
      end if;
      if not public.is_admin() and (
           new.is_suspended   is distinct from old.is_suspended
        or new.suspended_at   is distinct from old.suspended_at
        or new.suspended_reason is distinct from old.suspended_reason
        or new.suspended_by   is distinct from old.suspended_by
      ) then
        raise exception 'Not allowed to change protected account fields.' using errcode = '42501';
      end if;
    elsif tg_table_name = 'artist_profiles' then
      if not public.is_admin() and (
           new.verification_status is distinct from old.verification_status
        or new.verified_at         is distinct from old.verified_at
        or new.verification_method is distinct from old.verification_method
        or new.is_listed           is distinct from old.is_listed
        or new.average_rating      is distinct from old.average_rating
        or new.review_count        is distinct from old.review_count
        or new.total_bookings      is distinct from old.total_bookings
      ) then
        raise exception 'Not allowed to change protected profile fields.' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists aa_protect_sensitive on public.profiles;
create trigger aa_protect_sensitive before update on public.profiles
  for each row execute function public.protect_sensitive_columns();

drop trigger if exists aa_protect_sensitive on public.artist_profiles;
create trigger aa_protect_sensitive before update on public.artist_profiles
  for each row execute function public.protect_sensitive_columns();

-- ------------------------------------------------------------
-- 3. AUDIT LOG
-- ------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  actor_id      uuid,
  action        text not null,
  target_table  text,
  target_id     text,
  summary       text,
  detail        jsonb not null default '{}'::jsonb
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log(created_at desc);
create index if not exists admin_audit_log_actor_idx   on public.admin_audit_log(actor_id);

-- Locked: nobody reads or writes this table directly. Admins read it through
-- admin_audit (below); writes come from the trigger, admin_log(), or Edge Functions.
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;

-- Records a named admin action (used by the site for exports, chat access, and so on).
create or replace function public.admin_log(
  p_action text, p_target_table text default null, p_target_id text default null,
  p_summary text default null, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  insert into public.admin_audit_log(actor_id, action, target_table, target_id, summary, detail)
  values (auth.uid(), p_action, p_target_table, p_target_id, p_summary, coalesce(p_detail, '{}'::jsonb));
end;
$$;
revoke all on function public.admin_log(text,text,text,text,jsonb) from public, anon;
grant execute on function public.admin_log(text,text,text,text,jsonb) to authenticated;

-- Automatic record of every change an admin makes to a moderated table.
create or replace function public.audit_admin_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  old_j jsonb; new_j jsonb; changed jsonb := '{}'::jsonb; k text; tid text; src jsonb;
begin
  if not public.is_admin() then
    return coalesce(new, old);
  end if;

  old_j := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  new_j := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  src   := coalesce(new_j, old_j);

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(new_j) loop
      if k <> 'updated_at' and (new_j -> k) is distinct from (old_j -> k) then
        changed := changed || jsonb_build_object(k, jsonb_build_object('from', old_j -> k, 'to', new_j -> k));
      end if;
    end loop;
    if changed = '{}'::jsonb then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    changed := new_j;
  else
    changed := old_j;
  end if;

  tid := coalesce(src->>'booking_id', src->>'review_id', src->>'message_id', src->>'service_id',
                  src->>'ref_id', src->>'user_id', src->>'key');

  insert into public.admin_audit_log(actor_id, action, target_table, target_id, summary, detail)
  values (auth.uid(), lower(tg_op), tg_table_name, tid,
          initcap(lower(tg_op)) || ' on ' || tg_table_name, changed);

  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['bookings','reviews','support_messages','services','app_settings',
                           'verification_settings','artist_profiles','profiles','user_reports','artist_services']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists zz_audit_admin on public.%I', t);
      execute format('create trigger zz_audit_admin after insert or update or delete on public.%I
                      for each row execute function public.audit_admin_changes()', t);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 4. ADMIN ACCESS TO THE TABLES THEY MODERATE
-- ------------------------------------------------------------
-- Settings tables: if row level security was somehow off, turn it on safely.
do $$
declare t text; rls boolean;
begin
  foreach t in array array['app_settings','verification_settings'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    select relrowsecurity into rls from pg_class where oid = to_regclass('public.' || t);
    if rls is false then
      execute format('alter table public.%I enable row level security', t);
      if t = 'app_settings' then
        -- The app reads these (non-secret) values, so keep them readable.
        execute 'drop policy if exists app_settings_public_read on public.app_settings';
        execute 'create policy app_settings_public_read on public.app_settings for select to anon, authenticated using (true)';
      end if;
    end if;
  end loop;
end $$;

-- One policy per table: admins can do everything there. Existing policies for normal
-- users are left exactly as they are (policies add up, they do not replace each other).
do $$
declare t text;
begin
  foreach t in array array['bookings','reviews','support_messages','services','app_settings',
                           'verification_settings','artist_profiles','profiles','user_reports',
                           'artist_services','user_blocks','terms_acceptances']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists admin_all_%s on public.%I', t, t);
    execute format('create policy admin_all_%s on public.%I for all to authenticated
                    using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end $$;

-- Table privileges the admin needs on top of what the app already grants.
-- Only granted where row level security is on, so a normal user still cannot use them.
do $$
declare r record; rls boolean;
begin
  for r in select * from (values
      ('reviews',               'update, delete'),
      ('support_messages',      'select, update'),
      ('services',              'insert, update, delete'),
      ('app_settings',          'select, insert, update'),
      ('verification_settings', 'select, insert, update'),
      ('user_reports',          'select, update'),
      ('user_blocks',           'select'),
      ('terms_acceptances',     'select'),
      ('bookings',              'select, update'),
      ('artist_profiles',       'select, update'),
      ('profiles',              'select, update'),
      ('artist_services',       'select, insert, update, delete')
    ) as v(tbl, privs)
  loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;
    select relrowsecurity into rls from pg_class where oid = to_regclass('public.' || r.tbl);
    if rls is not true then
      raise notice 'SKIPPED grants on %: row level security is OFF. Turn it on, then run this file again.', r.tbl;
      continue;
    end if;
    execute format('grant %s on public.%I to authenticated', r.privs, r.tbl);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 5. ADMIN VIEWS (read-only, admins only)
-- ------------------------------------------------------------
-- Each view runs with the owner's rights so it can join across users, and each one
-- ends with "where public.is_admin()" so anyone else simply gets zero rows.

drop view if exists public.admin_users cascade;
create view public.admin_users with (security_invoker = false) as
select
  p.user_id, p.role, p.full_name, p.email, p.phone, p.city, p.avatar_url,
  p.is_deactivated, p.is_suspended, p.suspended_reason, p.suspended_at, p.created_at,
  u.last_sign_in_at,
  ap.business_name, ap.verification_status, ap.is_listed, ap.is_available,
  ap.average_rating, ap.review_count,
  (select count(*) from public.bookings b where b.client_id = p.user_id or b.artist_id = p.user_id) as booking_count,
  (select count(*) from public.user_reports r where r.reported_id = p.user_id) as reports_against
from public.profiles p
left join auth.users u on u.id = p.user_id
left join public.artist_profiles ap on ap.user_id = p.user_id
where public.is_admin();

drop view if exists public.admin_bookings cascade;
create view public.admin_bookings with (security_invoker = false) as
select
  b.*,
  cp.full_name as client_name, cp.email as client_email,
  ap.business_name as artist_name,
  s.service_name,
  exists (select 1 from public.booking_codes c where c.booking_id = b.booking_id and c.used_at is not null) as session_started
from public.bookings b
join public.profiles cp on cp.user_id = b.client_id
join public.artist_profiles ap on ap.user_id = b.artist_id
join public.services s on s.service_id = b.service_id
where public.is_admin();

drop view if exists public.admin_payments cascade;
create view public.admin_payments with (security_invoker = false) as
select
  p.*,
  b.booking_date, b.status as booking_status,
  cp.full_name as client_name, ap.business_name as artist_name
from public.payments p
left join public.bookings b on b.booking_id = p.booking_id
left join public.profiles cp on cp.user_id = b.client_id
left join public.artist_profiles ap on ap.user_id = b.artist_id
where public.is_admin();

drop view if exists public.admin_refunds cascade;
create view public.admin_refunds with (security_invoker = false) as
select
  r.*,
  p.reference as payment_reference, p.kind as payment_kind,
  b.booking_date, cp.full_name as client_name, ap.business_name as artist_name
from public.refunds r
left join public.payments p on p.payment_id = r.payment_id
left join public.bookings b on b.booking_id = r.booking_id
left join public.profiles cp on cp.user_id = b.client_id
left join public.artist_profiles ap on ap.user_id = b.artist_id
where public.is_admin();

drop view if exists public.admin_payouts cascade;
create view public.admin_payouts with (security_invoker = false) as
select
  po.*,
  ap.business_name as artist_name,
  pa.bank_name, pa.account_last4
from public.payouts po
left join public.artist_profiles ap on ap.user_id = po.artist_id
left join public.artist_payout_accounts pa on pa.artist_id = po.artist_id
where public.is_admin();

drop view if exists public.admin_artist_earnings cascade;
create view public.admin_artist_earnings with (security_invoker = false) as
select
  e.artist_id,
  ap.business_name as artist_name,
  coalesce(sum(e.gross), 0)        as gross,
  coalesce(sum(e.platform_fee), 0) as platform_fee,
  coalesce(sum(e.net), 0)          as net,
  coalesce(sum(e.net) filter (where e.status = 'held'), 0)       as held,
  coalesce(sum(e.net) filter (where e.status = 'available'), 0)  as available,
  coalesce(sum(e.net) filter (where e.status = 'in_payout'), 0)  as in_payout,
  coalesce(sum(e.net) filter (where e.status = 'paid_out'), 0)   as paid_out,
  coalesce(sum(e.net) filter (where e.status = 'refund_due'), 0) as refund_due
from public.artist_earnings e
left join public.artist_profiles ap on ap.user_id = e.artist_id
where public.is_admin()
group by e.artist_id, ap.business_name;

drop view if exists public.admin_reviews cascade;
create view public.admin_reviews with (security_invoker = false) as
select
  r.review_id, r.booking_id, r.client_id, r.artist_id, r.rating, r.review_text, r.is_visible, r.created_at,
  cp.full_name as client_name, ap.business_name as artist_name, s.service_name
from public.reviews r
left join public.profiles cp on cp.user_id = r.client_id
left join public.artist_profiles ap on ap.user_id = r.artist_id
left join public.bookings b on b.booking_id = r.booking_id
left join public.services s on s.service_id = b.service_id
where public.is_admin();

drop view if exists public.admin_reports cascade;
create view public.admin_reports with (security_invoker = false) as
select
  r.*,
  rp.full_name as reporter_name, rp.email as reporter_email,
  dp.full_name as reported_name, dp.email as reported_email,
  dp.role as reported_role, dp.is_suspended as reported_suspended
from public.user_reports r
left join public.profiles rp on rp.user_id = r.reporter_id
left join public.profiles dp on dp.user_id = r.reported_id
where public.is_admin();

drop view if exists public.admin_verifications cascade;
create view public.admin_verifications with (security_invoker = false) as
select
  v.id, v.user_id, v.status, v.doc_type, v.reason_code, v.review_deadline, v.decided_at,
  v.created_at, v.updated_at, v.method,
  (v.file_path is not null) as has_photo,
  p.full_name, p.email, ap.business_name, ap.verification_status as profile_status,
  (select e.detail from public.verification_events e
    where e.request_id = v.id and e.event = 'sent_to_review'
    order by e.created_at desc limit 1) as review_detail
from public.verification_requests v
left join public.profiles p on p.user_id = v.user_id
left join public.artist_profiles ap on ap.user_id = v.user_id
where public.is_admin();

drop view if exists public.admin_verification_events cascade;
create view public.admin_verification_events with (security_invoker = false) as
select e.*, pr.full_name as actor_name
from public.verification_events e
left join public.profiles pr on pr.user_id::text = e.actor::text
where public.is_admin();

drop view if exists public.admin_services cascade;
create view public.admin_services with (security_invoker = false) as
select
  s.*,
  (select count(*) from public.artist_services x where x.service_id = s.service_id) as artist_count,
  cp.full_name as created_by_name
from public.services s
left join public.profiles cp on cp.user_id = s.created_by
where public.is_admin();

drop view if exists public.admin_audit cascade;
create view public.admin_audit with (security_invoker = false) as
select l.*, p.full_name as actor_name, p.email as actor_email
from public.admin_audit_log l
left join public.profiles p on p.user_id = l.actor_id
where public.is_admin();

do $$
declare v text;
begin
  foreach v in array array['admin_users','admin_bookings','admin_payments','admin_refunds','admin_payouts',
    'admin_artist_earnings','admin_reviews','admin_reports','admin_verifications',
    'admin_verification_events','admin_services','admin_audit']
  loop
    execute format('revoke all on public.%I from public, anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 6. ADMIN FUNCTIONS
-- ------------------------------------------------------------

-- Everything the Overview page needs, in one call.
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare out jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'clients',            (select count(*) from public.profiles where role = 'client'),
    'artists',            (select count(*) from public.profiles where role = 'artist'),
    'artists_listed',     (select count(*) from public.artist_profiles where is_listed = true),
    'artists_unverified', (select count(*) from public.artist_profiles where verification_status = 'unverified'),
    'signups_7d',         (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'suspended',          (select count(*) from public.profiles where is_suspended),
    'bookings_total',     (select count(*) from public.bookings),
    'bookings_today',     (select count(*) from public.bookings where booking_date = current_date),
    'bookings_by_status', coalesce((select jsonb_object_agg(status, n)
                                      from (select status, count(*) n from public.bookings group by status) s), '{}'::jsonb),
    'booked_value_30d',   coalesce((select sum(price) from public.bookings
                                     where status = 'completed' and booking_date > current_date - 30), 0),
    'collected_30d',      coalesce((select sum(amount) from public.payments
                                     where status = 'success' and coalesce(paid_at, created_at) > now() - interval '30 days'), 0),
    'platform_fees_30d',  coalesce((select sum(platform_fee) from public.artist_earnings
                                     where created_at > now() - interval '30 days'), 0),
    'platform_fees_total',coalesce((select sum(platform_fee) from public.artist_earnings), 0),
    'queue', jsonb_build_object(
      'verifications',    (select count(*) from public.verification_requests where status = 'needs_review'),
      'reports',          (select count(*) from public.user_reports where status in ('open','investigating')),
      'support',          (select count(*) from public.support_messages where status in ('new','in_progress')),
      'refunds',          (select count(*) from public.refunds where status in ('due','failed','processing')),
      'payouts_failed',   (select count(*) from public.payouts where status in ('failed','reversed')
                                                                and created_at > now() - interval '14 days'),
      'payouts_processing',(select count(*) from public.payouts where status = 'processing'),
      'hidden_reviews',   (select count(*) from public.reviews where is_visible = false)
    ),
    'top_services', coalesce((select jsonb_agg(t) from (
        select s.service_name as name, count(*) as value
        from public.bookings b join public.services s on s.service_id = b.service_id
        where b.status in ('confirmed','in_progress','completed')
        group by s.service_name order by count(*) desc limit 6) t), '[]'::jsonb),
    'top_cities', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(trim(location), ''), 'Unknown') as name, count(*) as value
        from public.artist_profiles group by 1 order by count(*) desc limit 6) t), '[]'::jsonb),
    'top_artists', coalesce((select jsonb_agg(t) from (
        select ap.business_name as name, count(*) as value, ap.average_rating as rating, ap.user_id as id
        from public.bookings b join public.artist_profiles ap on ap.user_id = b.artist_id
        where b.status = 'completed' group by ap.user_id, ap.business_name, ap.average_rating
        order by count(*) desc limit 5) t), '[]'::jsonb)
  ) into out;

  return out;
end;
$$;

-- One row per day for the Overview charts.
create or replace function public.admin_timeseries(p_days integer default 30)
returns table(day date, bookings bigint, completed bigint, collected numeric, signups bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  p_days := greatest(7, least(coalesce(p_days, 30), 180));

  return query
  select d::date,
    (select count(*) from public.bookings b where b.created_at::date = d::date),
    (select count(*) from public.bookings b where b.status = 'completed' and b.booking_date = d::date),
    coalesce((select sum(pm.amount) from public.payments pm
               where pm.status = 'success' and coalesce(pm.paid_at, pm.created_at)::date = d::date), 0),
    (select count(*) from public.profiles pr where pr.created_at::date = d::date)
  from generate_series(current_date - (p_days - 1), current_date, interval '1 day') d
  order by d;
end;
$$;

-- Reading a private booking chat needs a written reason, and the access is logged.
create or replace function public.admin_booking_chat(p_booking uuid, p_reason text)
returns table(message_id uuid, sender_id uuid, sender_name text, body text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Please give a reason for reading this chat (at least 5 characters).';
  end if;

  insert into public.admin_audit_log(actor_id, action, target_table, target_id, summary, detail)
  values (auth.uid(), 'read_chat', 'booking_messages', p_booking::text,
          'Read private booking chat', jsonb_build_object('reason', trim(p_reason)));

  return query
  select m.message_id, m.sender_id, coalesce(pr.full_name, 'Unknown'), m.body, m.created_at
  from public.booking_messages m
  left join public.profiles pr on pr.user_id = m.sender_id
  where m.booking_id = p_booking
  order by m.created_at;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['admin_dashboard()','admin_timeseries(integer)','admin_booking_chat(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 7. CREATE YOUR FIRST ADMIN  (run by hand, once per admin)
-- ------------------------------------------------------------
-- 1. Create the person's account in the normal way (Supabase > Authentication > Add user,
--    or sign up in the Availa app), so a row exists in public.profiles.
-- 2. Then run, with their email:
--
--      update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- Roles cannot be changed from the browser on purpose, so this is the only way to add
-- or remove an admin. To remove one:
--
--      update public.profiles set role = 'client' where email = 'old-admin@example.com';
--
-- Strongly recommended: turn on multi-factor authentication for admin accounts in
-- Supabase (Authentication > Multi-Factor).
-- ============================================================
