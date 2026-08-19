-- ═══════════════════════════════════════════════════════════════════════════════
-- Shessage — Supabase schema
-- Run this in the Supabase Dashboard → SQL Editor (or `supabase db push`).
-- It is idempotent: safe to run from top to bottom, and safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────────────────────────────────────────────────────────────────────────────
-- Tables
-- ───────────────────────────────────────────────────────────────────────────────

-- 1:1 with auth.users. Created automatically by a trigger on sign up.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  name text, -- group name (null for 1:1)
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

-- LiveKit screen-share sessions, one active row per conversation at a time.
create table if not exists public.screen_shares (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sharer_id uuid not null references auth.users (id),
  room_name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists screen_shares_conversation_idx
  on public.screen_shares (conversation_id);

-- ───────────────────────────────────────────────────────────────────────────────
-- Triggers
-- ───────────────────────────────────────────────────────────────────────────────

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(coalesce(new.email, 'user'), '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Keep conversations.last_message_at fresh so the sidebar can sort by recency.
create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists on_message_created on public.messages;
create trigger on_message_created
  after insert on public.messages
  for each row execute procedure public.touch_conversation();

-- ───────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ───────────────────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.screen_shares enable row level security;

-- Drop EVERY existing policy on these tables so re-running this file always
-- leaves the project in a known-good state (fixes stale/incorrect policies).
do $$
declare pol record;
begin
  for pol in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'conversations', 'conversation_participants', 'messages', 'screen_shares')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- Helper: is the current user a participant of the given conversation?
create or replace function public.is_participant(conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = $1 and cp.user_id = auth.uid()
  );
$$;

-- Profiles: readable by signed-in users (needed for search + participant
-- display), only the owner can update their own row.
create policy "Profiles are viewable by everyone"
  on public.profiles for select to authenticated
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id);

-- Conversations
create policy "Read conversations you participate in"
  on public.conversations for select to authenticated
  using (public.is_participant(id));

-- Anyone signed in may create a conversation; membership is added separately
-- (and only by participants) via conversation_participants policies.
create policy "Anyone signed in can create a conversation"
  on public.conversations for insert to authenticated
  with check (true);

create policy "Update conversations you participate in"
  on public.conversations for update to authenticated
  using (public.is_participant(id));

-- Participants: read rows of conversations you're in; insert your own
-- membership, or add members once you're already a participant.
create policy "Read participants of conversations you're in"
  on public.conversation_participants for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_participant(conversation_id)
  );

create policy "Insert participants for yourself or conversations you're in"
  on public.conversation_participants for insert to authenticated
  with check (
    user_id = auth.uid()
    or public.is_participant(conversation_id)
  );

-- Messages
create policy "Read messages in conversations you're in"
  on public.messages for select to authenticated
  using (public.is_participant(conversation_id));

create policy "Insert messages in conversations you're in"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_participant(conversation_id)
  );

-- Screen shares
create policy "Read screen shares in conversations you're in"
  on public.screen_shares for select to authenticated
  using (public.is_participant(conversation_id));

create policy "Insert screen shares you start in conversations you're in"
  on public.screen_shares for insert to authenticated
  with check (
    sharer_id = auth.uid()
    and public.is_participant(conversation_id)
  );

create policy "Update screen shares in conversations you're in"
  on public.screen_shares for update to authenticated
  using (public.is_participant(conversation_id));

-- ───────────────────────────────────────────────────────────────────────────────
-- Realtime
-- ───────────────────────────────────────────────────────────────────────────────
-- Broadcasts row changes so the app can update live without polling.
-- Idempotent: only adds tables that aren't already members.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
    ) then
      alter publication supabase_realtime add table public.conversations;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_participants'
    ) then
      alter publication supabase_realtime add table public.conversation_participants;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'screen_shares'
    ) then
      alter publication supabase_realtime add table public.screen_shares;
    end if;
  end if;
end $$;
