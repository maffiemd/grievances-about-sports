-- Run this once in the Supabase SQL editor for your project
-- (Project -> SQL Editor -> New query -> paste -> Run).

create extension if not exists pgcrypto;

create table if not exists subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  subscribed boolean not null default true,
  unsubscribe_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- The newsletter send only ever queries `where subscribed = true` (see
-- scripts/send-newsletter.js), so a partial index keeps that lookup fast
-- without paying to index the (much less common) unsubscribed rows.
create index if not exists subscribers_subscribed_idx on subscribers (subscribed) where subscribed = true;

alter table subscribers enable row level security;

-- The public (anon) key may insert new subscribers...
create policy "public can subscribe" on subscribers
  for insert
  with check (true);

-- ...but there is no select/update/delete policy for anon, so the
-- subscriber list can never be read or modified directly through the
-- public key. The only other public-facing operation is the narrow
-- unsubscribe() function below.

create or replace function unsubscribe(token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update subscribers set subscribed = false where unsubscribe_token = token;
$$;

grant execute on function unsubscribe(uuid) to anon;

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  post_path text not null,
  author_name text not null,
  body text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Matches the read path exactly (assets/js/comments.js filters by post_path,
-- relies on the approved = true RLS policy below, and sorts by created_at),
-- so one compound index covers the filter and the sort together.
create index if not exists comments_post_path_approved_created_idx on comments (post_path, approved, created_at);

alter table comments enable row level security;

-- The public (anon) key may insert new comments...
create policy "public can submit comments" on comments
  for insert
  with check (true);

-- ...and read only comments that have been approved. New comments start
-- unapproved (see the `approved` default above) so nothing appears on the
-- site until you flip that column to true - e.g. in the Supabase dashboard's
-- Table Editor, or with `update comments set approved = true where id = ...`
-- in the SQL Editor. There is no update/delete policy for anon, so once a
-- comment is submitted, only you (via the dashboard, which bypasses RLS)
-- can approve, edit, or remove it.
create policy "public can read approved comments" on comments
  for select
  using (approved = true);
