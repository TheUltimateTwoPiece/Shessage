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
   - `messages` — conversation messages
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

## 6. Deploy to Vercel

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
  useMessages.ts          # history pagination + realtime inserts
  usePresence.ts          # online/offline via Realtime presence
  useUserSearch.ts        # debounced user search
lib/
  supabase/               # browser + server clients
  conversations.ts        # create 1:1 / group conversations
  types.ts, utils.ts
proxy.ts                  # Next.js proxy (session refresh)
supabase/schema.sql       # tables + RLS + realtime
```

## Known limitations (MVP)

- Messages show a "delivered" ✓ once stored; read receipts are not tracked.
- If a sharer closes their tab, the share ends when the LiveKit room closes
  (viewers clean up the dangling row automatically).
- Group member management (adding/removing members after creation) is not
  built yet.
