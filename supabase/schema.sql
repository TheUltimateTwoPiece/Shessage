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
  bio text,
  created_at timestamptz not null default now()
);

-- (Upgrade path for projects where the table already exists.)
alter table public.profiles
  add column if not exists bio text;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  name text, -- group name (null for 1:1)
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null constraint conversation_participants_user_id_profiles_fkey
    references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null constraint messages_sender_id_profiles_fkey
    references public.profiles (id),
  content text not null,
  created_at timestamptz not null default now()
);

-- File attachments live in Supabase Storage; each message stores an array of
-- {path, url, name, size, mime} under this column.
alter table public.messages
  add column if not exists attachments jsonb not null default '[]';

-- Reply-to: a snapshot of the message being replied to (rendered as a quote
-- above the message). Stored inline so it works over realtime without extra
-- fetches: { id, sender_name, content, attachment_name }.
alter table public.messages
  add column if not exists reply_to jsonb;

-- Message lifecycle flags (WhatsApp-style actions):
--   edited_at  — set when the sender edits the text
--   deleted_at — soft delete ("deleted for everyone"); content is blanked
--   pinned_at  — set when a participant pins the message
-- Mutations go through the security-definer RPCs below, never direct updates.
alter table public.messages
  add column if not exists edited_at timestamptz;
alter table public.messages
  add column if not exists deleted_at timestamptz;
alter table public.messages
  add column if not exists pinned_at timestamptz;

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

-- PostgREST needs a foreign-key relationship to embed `profiles` for sender
-- names/avatars (e.g. `messages(profiles(*))` and
-- `conversation_participants(profiles(*))`). Profiles is 1:1 with auth.users,
-- so the FKs below point at `profiles`. Idempotent: skipped if already present,
-- which also upgrades projects that were created before this relationship
-- existed (their older `auth.users` FK can stay).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversation_participants_user_id_profiles_fkey') then
    alter table public.conversation_participants
      add constraint conversation_participants_user_id_profiles_fkey
      foreign key (user_id) references public.profiles (id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_sender_id_profiles_fkey') then
    alter table public.messages
      add constraint messages_sender_id_profiles_fkey
      foreign key (sender_id) references public.profiles (id);
  end if;
end $$;

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
    select schemaname, tablename, policyname
    from pg_policies
    where (schemaname = 'public' and tablename in ('profiles', 'conversations', 'conversation_participants', 'messages', 'screen_shares'))
       or (schemaname = 'storage' and tablename = 'objects')
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
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
-- Helpers
-- ───────────────────────────────────────────────────────────────────────────────

-- Latest message per conversation for the current user (used by the sidebar
-- previews). Lets the client avoid fetching every message in every
-- conversation just to render a one-line preview.
drop function if exists public.get_last_message();
create function public.get_last_message()
returns table (
  conversation_id uuid,
  id uuid,
  sender_id uuid,
  content text,
  attachments jsonb,
  deleted_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (m.conversation_id)
    m.conversation_id, m.id, m.sender_id, m.content, m.attachments, m.deleted_at, m.created_at
  from public.messages m
  join public.conversation_participants cp
    on cp.conversation_id = m.conversation_id
   and cp.user_id = auth.uid()
  order by m.conversation_id, m.created_at desc
$$;

grant execute on function public.get_last_message() to authenticated;

-- Message actions: edit/delete are restricted to the sender; pin is open to
-- any participant. All run as the table owner (security definer) so direct
-- UPDATEs stay locked down by RLS.
create or replace function public.edit_message(p_message_id uuid, p_content text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.messages
    where id = p_message_id and sender_id = auth.uid() and deleted_at is null
  ) then
    raise exception 'You can only edit your own messages';
  end if;
  update public.messages
  set content = p_content, edited_at = now()
  where id = p_message_id;
end;
$$;

create or replace function public.delete_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.messages
    where id = p_message_id and sender_id = auth.uid() and deleted_at is null
  ) then
    raise exception 'You can only delete your own messages';
  end if;
  update public.messages
  set content = '', deleted_at = now()
  where id = p_message_id;
end;
$$;

create or replace function public.pin_message(p_message_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.messages m
    join public.conversation_participants cp
      on cp.conversation_id = m.conversation_id and cp.user_id = auth.uid()
    where m.id = p_message_id
  ) then
    raise exception 'You are not a participant of this conversation';
  end if;
  update public.messages
  set pinned_at = case when p_pinned then now() else null end
  where id = p_message_id;
end;
$$;

grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.delete_message(uuid) to authenticated;
grant execute on function public.pin_message(uuid, boolean) to authenticated;

-- ───────────────────────────────────────────────────────────────────────────────
-- Storage (message attachments)
-- ───────────────────────────────────────────────────────────────────────────────
-- Public bucket so attachment URLs render directly. Uploads are restricted to
-- participants of the conversation encoded in the object path:
--   {conversation_id}/{user_id}/{uuid}-{filename}
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', true)
on conflict (id) do nothing;

-- (RLS on storage.objects is enabled by default in Supabase projects; the
-- policies below gate uploads. The management API can't toggle it, so it's
-- not repeated here.)

create policy "Anyone can view message attachments"
  on storage.objects for select
  using (bucket_id = 'message-attachments');

create policy "Participants can upload message attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and auth.uid() = (storage.foldername(name))[2]::uuid
    and public.is_participant((storage.foldername(name))[1]::uuid)
  );

-- Uploaders can delete their own attachments.
create policy "Uploaders can delete their own message attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'message-attachments'
    and auth.uid() = (storage.foldername(name))[2]::uuid
  );

-- Profile avatars: public bucket so avatar URLs render everywhere. Each user
-- can only write to their own folder: {user_id}/{uuid}-{filename}
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Anyone can view avatars"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Upload your own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );

create policy "Delete your own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );

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
