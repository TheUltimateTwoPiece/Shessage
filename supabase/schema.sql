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
  avatar_url text, -- group profile picture
  bio text, -- group bio
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- (Upgrade path for projects where the tables already exist.)
alter table public.conversations
  add column if not exists avatar_url text;
alter table public.conversations
  add column if not exists bio text;

-- Group hierarchy: owner (creator) > admin > member. Promotions/demotions
-- and removals go through the security-definer RPCs below; direct inserts
-- may only ever create `member` rows (enforced by the RLS insert policy).
create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null constraint conversation_participants_user_id_profiles_fkey
    references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  role text not null default 'member',
  primary key (conversation_id, user_id)
);

alter table public.conversation_participants
  add column if not exists role text not null default 'member';
alter table public.conversation_participants
  drop constraint if exists conversation_participants_role_check,
  add constraint conversation_participants_role_check
    check (role in ('owner', 'admin', 'member'));

-- Existing groups: make the first-joined participant the owner so pre-existing
-- groups aren't stuck without any admin. Stable across re-runs.
update public.conversation_participants cp
set role = 'owner'
from public.conversations c
where c.id = cp.conversation_id
  and c.is_group = true
  and cp.joined_at = (
    select min(cp2.joined_at)
    from public.conversation_participants cp2
    where cp2.conversation_id = cp.conversation_id
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

-- End-to-end encryption (see README for the full design):
--   user_keys          — one row per device per user, holding that device's
--                        X25519 public key (the private key never leaves the
--                        device; it lives encrypted in the browser's
--                        localStorage).
--   conversation_keys  — the per-conversation symmetric key, wrapped to each
--                        participant's device public key (nacl.box). One row
--                        per (conversation, user, device, key generation).
--                        Generations are never deleted, so old messages stay
--                        decryptable after a rotation.
--   messages.key_id    — which key generation encrypted this message.
create table if not exists public.user_keys (
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_key_id uuid not null,
  public_key text not null, -- base64 X25519 public key
  created_at timestamptz not null default now(),
  primary key (user_id, device_key_id)
);

create table if not exists public.conversation_keys (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_key_id uuid not null,
  key_id uuid not null, -- identifies the key generation
  ciphertext text not null, -- base64(ephemeral_pub || nonce || box(key))
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id, device_key_id, key_id)
);

create index if not exists conversation_keys_lookup_idx
  on public.conversation_keys (conversation_id, user_id, device_key_id, created_at desc);

alter table public.messages
  add column if not exists key_id uuid;

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
alter table public.user_keys enable row level security;
alter table public.conversation_keys enable row level security;

-- Drop EVERY existing policy on these tables so re-running this file always
-- leaves the project in a known-good state (fixes stale/incorrect policies).
do $$
declare pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where (schemaname = 'public' and tablename in ('profiles', 'conversations', 'conversation_participants', 'messages', 'screen_shares', 'user_keys', 'conversation_keys'))
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

-- Is the current user an owner or admin of the given conversation?
create or replace function public.is_group_admin(conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = $1
      and cp.user_id = auth.uid()
      and cp.role in ('owner', 'admin')
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
  using (not is_group or public.is_group_admin(id))
  with check (not is_group or public.is_group_admin(id));

-- Participants: read rows of conversations you're in; insert your own
-- membership, or add members once you're already a participant.
create policy "Read participants of conversations you're in"
  on public.conversation_participants for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_participant(conversation_id)
  );

create policy "Admins can add members to their groups"
  on public.conversation_participants for insert to authenticated
  with check (
    public.is_group_admin(conversation_id)
    and coalesce(role, 'member') = 'member'
  );

-- End-to-end encryption keys: public keys are public by design (any
-- participant needs them to wrap conversation keys); users register their own
-- device keys; key rows may only be read/inserted by participants.
create policy "Anyone signed in can view device public keys"
  on public.user_keys for select to authenticated
  using (true);

create policy "Register your own device key"
  on public.user_keys for insert to authenticated
  with check (user_id = auth.uid());

create policy "Remove your own device key"
  on public.user_keys for delete to authenticated
  using (user_id = auth.uid());

create policy "Participants can read wrapped conversation keys"
  on public.conversation_keys for select to authenticated
  using (public.is_participant(conversation_id));

-- Any participant may store a wrapped copy of a conversation key for any
-- participant (rows are useless without the recipient's private key).
create policy "Participants can store wrapped conversation keys"
  on public.conversation_keys for insert to authenticated
  with check (
    public.is_participant(conversation_id)
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = conversation_id and cp.user_id = user_id
    )
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
  key_id uuid,
  deleted_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (m.conversation_id)
    m.conversation_id, m.id, m.sender_id, m.content, m.attachments, m.key_id, m.deleted_at, m.created_at
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

-- Group management. All security-definer; the RLS insert policy only ever
-- permits `member` rows directly, so ownership/admin flow through here.
create or replace function public.create_group(p_name text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_conv_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_member_ids is null or array_length(p_member_ids, 1) < 2 then
    raise exception 'A group needs at least 3 members (you + 2 others)';
  end if;
  insert into public.conversations (is_group, name)
  values (true, coalesce(nullif(trim(p_name), ''), 'Group'))
  returning id into v_conv_id;

  insert into public.conversation_participants (conversation_id, user_id, role)
  values (v_conv_id, v_me, 'owner');

  insert into public.conversation_participants (conversation_id, user_id, role)
  select v_conv_id, u.user_id, 'member'
  from unnest(p_member_ids) as u(user_id)
  where u.user_id is distinct from v_me
  on conflict do nothing;

  return v_conv_id;
end;
$$;

create or replace function public.set_member_role(p_conversation_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_target_role text;
begin
  if p_role not in ('admin', 'member') then
    raise exception 'Invalid role';
  end if;
  select role into v_caller_role from public.conversation_participants
  where conversation_id = p_conversation_id and user_id = auth.uid();
  if v_caller_role is null then
    raise exception 'You are not a participant of this conversation';
  end if;
  if v_caller_role not in ('owner', 'admin') then
    raise exception 'Only admins can change member roles';
  end if;
  select role into v_target_role from public.conversation_participants
  where conversation_id = p_conversation_id and user_id = p_user_id;
  if v_target_role is null then
    raise exception 'That user is not a member of this conversation';
  end if;
  if v_target_role = 'owner' then
    raise exception 'The owner cannot be demoted';
  end if;
  if v_caller_role = 'admin' and v_target_role = 'admin' then
    raise exception 'Admins cannot change other admins';
  end if;
  update public.conversation_participants
  set role = p_role
  where conversation_id = p_conversation_id and user_id = p_user_id;
end;
$$;

create or replace function public.remove_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_target_role text;
begin
  -- Anyone may leave a group they're in.
  if p_user_id = auth.uid() then
    delete from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = auth.uid();
    return;
  end if;
  select role into v_caller_role from public.conversation_participants
  where conversation_id = p_conversation_id and user_id = auth.uid();
  if v_caller_role is null then
    raise exception 'You are not a participant of this conversation';
  end if;
  if v_caller_role not in ('owner', 'admin') then
    raise exception 'Only admins can remove members';
  end if;
  select role into v_target_role from public.conversation_participants
  where conversation_id = p_conversation_id and user_id = p_user_id;
  if v_target_role is null then
    raise exception 'That user is not a member of this conversation';
  end if;
  if v_target_role = 'owner' then
    raise exception 'The owner cannot be removed';
  end if;
  if v_caller_role = 'admin' and v_target_role = 'admin' then
    raise exception 'Admins cannot remove other admins';
  end if;
  delete from public.conversation_participants
  where conversation_id = p_conversation_id and user_id = p_user_id;
end;
$$;

-- Admins can delete any message in a group they administer.
create or replace function public.delete_any_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv_id uuid;
begin
  select conversation_id into v_conv_id from public.messages where id = p_message_id;
  if v_conv_id is null then
    raise exception 'Message not found';
  end if;
  if not public.is_group_admin(v_conv_id) then
    raise exception 'Only group admins can delete other messages';
  end if;
  update public.messages
  set content = '', deleted_at = now()
  where id = p_message_id;
end;
$$;

-- Group name / bio / avatar updates (admins only).
create or replace function public.update_group_info(p_conversation_id uuid, p_name text, p_bio text, p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_group_admin(p_conversation_id) then
    raise exception 'Only admins can update group info';
  end if;
  update public.conversations
  set name = coalesce(nullif(trim(p_name), ''), name),
      bio = nullif(trim(p_bio), ''),
      avatar_url = p_avatar_url
  where id = p_conversation_id;
end;
$$;

-- 1:1 chats: find-or-create. Routing creation through an RPC (instead of
-- direct participant inserts) means no user can add themselves to a
-- conversation they aren't part of.
create or replace function public.create_direct_conversation(p_other_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_conv_id uuid;
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;
  if p_other_id is null or p_other_id = v_me then
    raise exception 'Invalid recipient';
  end if;

  -- Reuse an existing 1:1 between the two users.
  select cp1.conversation_id into v_conv_id
  from public.conversation_participants cp1
  join public.conversation_participants cp2
    on cp2.conversation_id = cp1.conversation_id
  join public.conversations c on c.id = cp1.conversation_id
  where cp1.user_id = v_me
    and cp2.user_id = p_other_id
    and c.is_group = false
    and (select count(*) from public.conversation_participants cp3
         where cp3.conversation_id = cp1.conversation_id) = 2
  limit 1;
  if v_conv_id is not null then
    return v_conv_id;
  end if;

  insert into public.conversations (is_group)
  values (false)
  returning id into v_conv_id;

  insert into public.conversation_participants (conversation_id, user_id, role)
  values (v_conv_id, v_me, 'member'), (v_conv_id, p_other_id, 'member');

  return v_conv_id;
end;
$$;

grant execute on function public.create_group(text, uuid[]) to authenticated;
grant execute on function public.create_direct_conversation(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.delete_any_message(uuid) to authenticated;
grant execute on function public.update_group_info(uuid, text, text, text) to authenticated;

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

-- Group avatars: public bucket; only owners/admins of a group can write into
-- its folder: {conversation_id}/{uuid}-{filename}
insert into storage.buckets (id, name, public)
values ('group-avatars', 'group-avatars', true)
on conflict (id) do nothing;

create policy "Anyone can view group avatars"
  on storage.objects for select
  using (bucket_id = 'group-avatars');

create policy "Group admins can upload avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'group-avatars'
    and public.is_group_admin((storage.foldername(name))[1]::uuid)
  );

create policy "Group admins can delete avatars"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'group-avatars'
    and public.is_group_admin((storage.foldername(name))[1]::uuid)
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
