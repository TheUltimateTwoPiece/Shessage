# Shessage 💬

A WhatsApp-style, end-to-end messaging app with **real-time text chat** and
**screen sharing**.

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind CSS
- **Backend / database / auth / realtime:** Supabase (Postgres + Auth + Realtime)
- **Screen sharing:** LiveKit (`livekit-client` + `@livekit/components-react`)
- **Hosting:** Vercel (deploys with no extra config)

## Features

- Email/password **auth** with a profile (display name, avatar, online status)
- **Conversation list** sorted by most recent activity, with last-message
  previews and timestamps
- Start a new **1:1 conversation** by searching for a user by name or email
- **Real-time 1:1 chat** (no manual refresh) with WhatsApp-style bubbles,
  timestamps, a delivered ✓, and scroll-up history pagination (30/page)
- **Group chats** with 3+ members and the sender's name above each message
- **Screen sharing** per conversation via LiveKit, with clear
  sharing / viewing / not-sharing states and graceful error handling
- **End-to-end encryption** — message bodies are encrypted on-device
  (X25519 + XSalsa20-Poly1305) so the server only ever stores ciphertext
- **Message actions** — reply, copy, pin, edit, delete (sender or group admin)
- **File attachments** — images render inline; other files show a download chip
- **Group hierarchy** — owner → admin → member, with group profile pictures
  and bios; admins can remove members, delete messages, and edit group info
- **Presence** — see which contacts are online (Supabase Realtime presence)
- Responsive two-pane layout that collapses to a single pane on mobile

---

## 1. Prerequisites

- Node.js 18.18+ (built with Node 24)
- A [Supabase](https://supabase.com) account (free tier is fine)
- A [LiveKit Cloud](https://livekit.io) account (free tier is fine)

---

## 2. Supabase setup

1. Create a new project in the Supabase dashboard.
2. Open **SQL Editor** and paste the entire contents of
   [`supabase/schema.sql`](./supabase/schema.sql), then run it. The script is
   idempotent — it's safe to re-run any time (it drops and recreates the RLS
   policies), so if you ever see RLS errors, just re-run it. It creates:

   - `profiles` — 1:1 with `auth.users`, auto-created on signup via a trigger
   - `conversations` — 1:1 or group chats
   - `conversation_participants` — membership, with the `is_participant()`
     helper used by the RLS policies
   - `user_keys` — each device's X25519 **public** key (used to wrap
     conversation keys for that device)
   - `conversation_keys` — the per-conversation symmetric key, wrapped to each
     participant's device key; one row per (conversation, user, device, key
     generation) so history survives key rotation
   - `messages` — conversation messages, with `attachments` (file uploads) and
     a `key_id` pointing at the key that encrypted it
   - `message-attachments` — a **public** Supabase Storage bucket for message
     files (uploads are restricted by RLS to conversation participants)
   - `avatars` — a **public** Supabase Storage bucket for profile pictures
     (each user can only write to their own folder)
   - `screen_shares` — active LiveKit screen-share sessions
   - **Row Level Security** on every table so users can only read/write
     conversations they participate in
   - Realtime publication for `messages`, `conversations`,
     `conversation_participants`, and `screen_shares`

   > If you prefer, you can also apply it from the CLI:
   > `supabase db push` (after linking your project) or
   > `supabase db execute --file supabase/schema.sql`.

3. Grab your credentials from **Project Settings → API**:
   - **Project URL** (e.g. `https://abcd1234.supabase.co`)
   - **anon public key**

4. (Optional) If your project has **email confirmation** enabled, new signups
   will need to confirm their email before logging in — the app handles this.

> **Realtime note:** On Supabase's free tier, tables are added to the
> `supabase_realtime` publication automatically. The schema makes this
> explicit. If you ever need to check, look under
> **Database → Publications → supabase_realtime**.

---

## 3. LiveKit setup

1. Create a new **LiveKit Cloud** project (or use a self-hosted server).
2. From **Settings**, copy:
   - **WebSocket URL** (e.g. `wss://your-project.livekit.cloud`) — this is the
     client-facing `NEXT_PUBLIC_LIVEKIT_URL`
3. From **Settings → Keys**, create a key and copy:
   - **API Key** (`LIVEKIT_API_KEY`)
   - **API Secret** (`LIVEKIT_API_SECRET`)

No rooms need to be pre-created — the app creates a room per conversation on
demand and issues short-lived access tokens server-side.

---

## 4. Local setup

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file from the template
cp .env.local.example .env.local
```

Fill in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://abcd1234.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret
```

> Secrets are only ever read from `process.env` — nothing is hardcoded.

## 5. Run it

```bash
npm run dev
```

Open http://localhost:3000. Sign up two users in different browsers (or an
incognito window), start a conversation between them, message in real time,
and hit **Share screen** to stream one user's screen to the other.

---

## 6. End-to-end encryption

Message **content** is end-to-end encrypted; the server (and anyone with
Postgres access) only ever sees ciphertext. Here's how it works:

1. **Device identity.** The first time you use the app on a device, the
   browser generates an X25519 keypair (via [tweetnacl](https://tweetnacl.js.org)).
   The public key is stored in `user_keys`; the private key never leaves the
   device — it lives in `localStorage`.
2. **Conversation key.** Every conversation has a random 32-byte symmetric
   key. It is wrapped (`nacl.box`) to each participant's device public key and
   stored in `conversation_keys`. Creating a conversation (or opening one that
   has no key yet) creates the key and wraps it for everyone in it.
3. **Messages.** On send, the text (and any reply quote) is encrypted with
   `nacl.secretbox` under the conversation key, then stored in
   `messages.content` as `v1:<base64>`. Recipients decrypt locally using the
   conversation key they unwrap with their own private key.
4. **Key rotation.** Removing a member or leaving a group rotates the
   conversation key (wrapped to everyone except the departing member), so they
   can't read future messages. Old key generations are kept, so history stays
   decryptable.

**What is *not* encrypted** (matches most messengers' metadata): sender,
conversation id, timestamps, attachment filenames/sizes, and the
edited/deleted/pinned flags. Pre-E2EE (legacy) plaintext messages still
render, but new messages are always encrypted.

**Limitations to know:**

- The private key is stored in the browser's `localStorage`. Anyone with
  access to your device/browser profile can read your keys (the same trust
  model as WhatsApp Web). Passphrase-protected keys would harden this.
- A brand-new device can only decrypt messages sent after its key was
  registered and wrapped; earlier messages show as locked.
- Attachments are not encrypted (the bucket is public, uploads are
  participant-gated).
- There is no key-verification UX yet (no safety-number comparison).

---

## 7. Deploy to Vercel

1. Push this repo to GitHub/GitLab and import it in Vercel (or use the Vercel
   CLI: `vercel`).
2. In **Project → Settings → Environment Variables**, add the same four
   variables from `.env.local`.
3. Deploy. No build config needed — Next.js is detected automatically.

---

## Project structure

```
app/
  actions/livekit.ts      # server actions: LiveKit tokens + share lifecycle
  chat/                   # protected chat app (layout + page)
  login/                  # login / signup page
  layout.tsx              # root layout
  page.tsx                # redirects based on auth
components/
  auth/AuthForm.tsx       # login / signup
  chat/                   # ChatApp, ConversationList, ChatWindow,
                          # MessageList/Bubble/Input, ScreenShareBar, modals
  Avatar.tsx
hooks/
  useConversations.ts     # sidebar list + realtime updates
  useMessages.ts          # history pagination + realtime inserts + decrypt
  usePresence.ts          # online/offline via Realtime presence
  useUserSearch.ts        # debounced user search
lib/
  supabase/               # browser + server clients
  conversations.ts        # create 1:1 / group conversations
  e2ee.ts                 # device keys, conversation keys, encrypt/decrypt
  attachments.ts          # storage uploads (avatars, files, group pics)
  types.ts, utils.ts
proxy.ts                  # Next.js proxy (session refresh)
supabase/schema.sql       # tables + RLS + realtime
```

## Known limitations (MVP)

- Messages show a "delivered" ✓ once stored; read receipts are not tracked.
- If a sharer closes their tab, the share ends when the LiveKit room closes
  (viewers clean up the dangling row automatically).
- There's no "add member to an existing group" button yet (groups are created
  with their members); removing members and leaving a group are supported.
- E2EE covers message content; see the E2EE section for its own limitations.
