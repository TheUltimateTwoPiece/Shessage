// ─────────────────────────────────────────────────────────────────────────────
// End-to-end encryption for Shessage.
//
// Design (see README for the full write-up):
//   * Every device generates an X25519 keypair. The public key is registered
//     in `user_keys`; the private key lives only on the device (localStorage)
//     and never leaves it.
//   * Every conversation has a random symmetric key. It is wrapped to each
//     participant's device public key (nacl.box) and stored in
//     `conversation_keys` — one row per (conversation, user, device, key
//     generation). Rows for old generations are kept so that history stays
//     decryptable after a rotation.
//   * Message bodies are the base64 of `v1:` + nacl.secretbox(payload) under
//     the conversation key. The payload is `{ t: text, r: reply | null }`.
//     Attachments metadata and message lifecycle flags (edited/deleted/pinned)
//     stay plaintext so the server can sort/filter, but the actual words are
//     never visible to the server.
//
// This module is isomorphic — it runs in the browser and in Node (tests).
// ─────────────────────────────────────────────────────────────────────────────

import nacl from "tweetnacl";
import { createClient } from "@/lib/supabase/client";
import type { Message, ReplyTo } from "@/lib/types";

export const E2EE_PREFIX = "v1:";

// ── encoding helpers (browser + node) ────────────────────────────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const IS_BROWSER = typeof window !== "undefined";

function b64encode(bytes: Uint8Array): string {
  if (IS_BROWSER) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString("base64");
}

function b64decode(s: string): Uint8Array {
  if (IS_BROWSER) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, "base64"));
}

function randomUUID(): string {
  return crypto.randomUUID();
}

// ── identity (one keypair per device, stored in localStorage) ───────────────

export type Identity = {
  deviceKeyId: string;
  publicKey: Uint8Array;
  secretKey: Uint8Array;
};

const IDENTITY_PREFIX = "shessage.identity.v1.";
const identityCache = new Map<string, Identity>();

export function hasLocalIdentity(userId: string): boolean {
  if (!IS_BROWSER) return false;
  return localStorage.getItem(IDENTITY_PREFIX + userId) !== null;
}

export function getLocalIdentity(userId: string): Identity | null {
  const cached = identityCache.get(userId);
  if (cached) return cached;
  if (!IS_BROWSER) return null;
  const raw = localStorage.getItem(IDENTITY_PREFIX + userId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const identity: Identity = {
      deviceKeyId: parsed.deviceKeyId,
      publicKey: b64decode(parsed.publicKey),
      secretKey: b64decode(parsed.secretKey),
    };
    identityCache.set(userId, identity);
    return identity;
  } catch {
    return null;
  }
}

export function createLocalIdentity(userId: string): Identity {
  const kp = nacl.box.keyPair();
  const identity: Identity = {
    deviceKeyId: randomUUID(),
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
  };
  if (IS_BROWSER) {
    localStorage.setItem(
      IDENTITY_PREFIX + userId,
      JSON.stringify({
        deviceKeyId: identity.deviceKeyId,
        publicKey: b64encode(identity.publicKey),
        secretKey: b64encode(identity.secretKey),
      })
    );
  }
  identityCache.set(userId, identity);
  return identity;
}

export function requireIdentity(userId: string): Identity {
  return (
    getLocalIdentity(userId) ??
    createLocalIdentity(userId)
  );
}

/** Call on logout: drop in-memory keys so the next account can't see them. */
export function clearLocalSession(): void {
  identityCache.clear();
  currentKeyCache.clear();
  keyCache.clear();
}

/**
 * Registers this device's public key in `user_keys` (idempotent). Call after
 * the user is authenticated so peers can wrap conversation keys to this
 * device.
 */
export async function registerDeviceKey(userId: string): Promise<void> {
  const identity = requireIdentity(userId);
  const supabase = createClient();
  const { error } = await supabase.from("user_keys").upsert(
    {
      user_id: userId,
      device_key_id: identity.deviceKeyId,
      public_key: b64encode(identity.publicKey),
    },
    { onConflict: "user_id,device_key_id" }
  );
  if (error) throw error;
}

// ── conversation keys ────────────────────────────────────────────────────────

export type KeyEntry = { keyId: string; key: Uint8Array };

// The key used for NEW messages, per conversation.
const currentKeyCache = new Map<string, KeyEntry>();
// Every key generation we've seen, per conversation — for decrypting history.
const keyCache = new Map<string, KeyEntry>();

function rememberKey(conversationId: string, entry: KeyEntry) {
  keyCache.set(`${conversationId}:${entry.keyId}`, entry);
}

function wrapKey(key: Uint8Array, recipientPublicKey: Uint8Array): string {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ct = nacl.box(key, nonce, recipientPublicKey, ephemeral.secretKey);
  const out = new Uint8Array(
    ephemeral.publicKey.length + nonce.length + ct.length
  );
  out.set(ephemeral.publicKey, 0);
  out.set(nonce, ephemeral.publicKey.length);
  out.set(ct, ephemeral.publicKey.length + nonce.length);
  return b64encode(out);
}

function unwrapKey(ciphertext: string, mySecretKey: Uint8Array): Uint8Array | null {
  try {
    const raw = b64decode(ciphertext);
    const pubLen = nacl.box.publicKeyLength;
    const nonceLen = nacl.box.nonceLength;
    if (raw.length < pubLen + nonceLen) return null;
    const ephemeralPub = raw.slice(0, pubLen);
    const nonce = raw.slice(pubLen, pubLen + nonceLen);
    const ct = raw.slice(pubLen + nonceLen);
    return nacl.box.open(ct, nonce, ephemeralPub, mySecretKey);
  } catch {
    return null;
  }
}

async function fetchParticipantDevices(conversationId: string): Promise<
  { userId: string; deviceKeyId: string; publicKey: Uint8Array }[]
> {
  const supabase = createClient();
  const { data: parts } = await supabase
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", conversationId);
  const userIds = (parts ?? []).map((p) => p.user_id);
  if (userIds.length === 0) return [];
  const { data: keys } = await supabase
    .from("user_keys")
    .select("user_id, device_key_id, public_key")
    .in("user_id", userIds);
  return (keys ?? []).map((k) => ({
    userId: k.user_id,
    deviceKeyId: k.device_key_id,
    publicKey: b64decode(k.public_key),
  }));
}

async function storeWrappedKey(
  conversationId: string,
  key: Uint8Array,
  keyId: string,
  devices: { userId: string; deviceKeyId: string; publicKey: Uint8Array }[]
): Promise<void> {
  if (devices.length === 0) return;
  const supabase = createClient();
  const rows = devices.map((d) => ({
    conversation_id: conversationId,
    user_id: d.userId,
    device_key_id: d.deviceKeyId,
    key_id: keyId,
    ciphertext: wrapKey(key, d.publicKey),
  }));
  const { error } = await supabase.from("conversation_keys").insert(rows);
  if (error) throw error;
}

/**
 * Returns the conversation key to use for NEW messages, creating and wrapping
 * one if this device doesn't have a row yet. When several clients race to
 * create a key, the newest row wins on the next call — everyone converges.
 */
export async function ensureConversationKey(
  conversationId: string,
  userId: string
): Promise<KeyEntry> {
  const cached = currentKeyCache.get(conversationId);
  if (cached) return cached;

  const identity = requireIdentity(userId);
  const supabase = createClient();
  const { data: mine } = await supabase
    .from("conversation_keys")
    .select("key_id, ciphertext, created_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .eq("device_key_id", identity.deviceKeyId)
    .order("created_at", { ascending: false });

  if (mine && mine.length > 0) {
    for (const row of mine) {
      const key = unwrapKey(row.ciphertext, identity.secretKey);
      if (key) {
        const entry: KeyEntry = { keyId: row.key_id, key };
        rememberKey(conversationId, entry);
        currentKeyCache.set(conversationId, entry);
        return entry;
      }
    }
  }

  // No usable row for this device — generate a fresh key for everyone.
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  const keyId = randomUUID();
  const devices = await fetchParticipantDevices(conversationId);
  await storeWrappedKey(conversationId, key, keyId, devices);
  const entry: KeyEntry = { keyId, key };
  rememberKey(conversationId, entry);
  currentKeyCache.set(conversationId, entry);
  return entry;
}

/**
 * Fetches the key for a specific generation (used to decrypt a message by its
 * `key_id`). Returns null when this device has no row for that key — e.g. a
 * device that joined after the key was created, or a removed member.
 */
export async function getConversationKeyById(
  conversationId: string,
  keyId: string | null | undefined,
  userId: string
): Promise<KeyEntry | null> {
  if (!keyId) return null;
  const cached = keyCache.get(`${conversationId}:${keyId}`);
  if (cached) {
    // A message with a newer key means the conversation rotated — make that
    // the key for future sends too.
    const current = currentKeyCache.get(conversationId);
    if (!current || current.keyId !== cached.keyId) {
      currentKeyCache.set(conversationId, cached);
    }
    return cached;
  }

  const identity = requireIdentity(userId);
  const supabase = createClient();
  const { data } = await supabase
    .from("conversation_keys")
    .select("ciphertext")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .eq("device_key_id", identity.deviceKeyId)
    .eq("key_id", keyId)
    .maybeSingle();
  if (!data) return null;
  const key = unwrapKey(data.ciphertext, identity.secretKey);
  if (!key) return null;
  const entry: KeyEntry = { keyId, key };
  rememberKey(conversationId, entry);
  const current = currentKeyCache.get(conversationId);
  if (!current || current.keyId !== keyId) {
    currentKeyCache.set(conversationId, entry);
  }
  return entry;
}

/**
 * Rotates the conversation key and wraps it for the current participants
 * (optionally excluding some — used when removing a member or leaving). Old
 * key rows are kept so history stays readable.
 */
export async function rotateConversationKey(
  conversationId: string,
  userId: string,
  excludeUserIds: string[]
): Promise<KeyEntry> {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  const keyId = randomUUID();
  const devices = await fetchParticipantDevices(conversationId);
  const filtered = devices.filter((d) => !excludeUserIds.includes(d.userId));
  await storeWrappedKey(conversationId, key, keyId, filtered);
  const entry: KeyEntry = { keyId, key };
  rememberKey(conversationId, entry);
  currentKeyCache.set(conversationId, entry);
  return entry;
}

// ── message payloads ─────────────────────────────────────────────────────────

export type MessagePayload = { t: string; r: ReplyTo | null };

export function encryptPayload(payload: MessagePayload, entry: KeyEntry): string {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const plain = encoder.encode(JSON.stringify(payload));
  const ct = nacl.secretbox(plain, nonce, entry.key);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return E2EE_PREFIX + b64encode(out);
}

export function decryptPayload(
  content: string,
  entry: KeyEntry
): MessagePayload | null {
  if (!content.startsWith(E2EE_PREFIX)) return null;
  try {
    const raw = b64decode(content.slice(E2EE_PREFIX.length));
    const nonce = raw.slice(0, nacl.secretbox.nonceLength);
    const ct = raw.slice(nacl.secretbox.nonceLength);
    const plain = nacl.secretbox.open(ct, nonce, entry.key);
    if (!plain) return null;
    return JSON.parse(decoder.decode(plain)) as MessagePayload;
  } catch {
    return null;
  }
}

export function isEncryptedContent(content: string): boolean {
  return content.startsWith(E2EE_PREFIX);
}

/**
 * Decrypts a message row in place: `content` becomes the plaintext and
 * `reply_to` the decrypted reply snapshot. Legacy (pre-E2EE) plaintext rows
 * and deleted rows pass through unchanged. On failure the row is flagged
 * `decryptFailed` (rendered as a locked message).
 */
export async function decryptMessageRow(
  row: Message,
  userId: string
): Promise<Message> {
  if (row.deleted_at) return { ...row, content: "" };
  if (!isEncryptedContent(row.content ?? "")) return row;
  const entry = await getConversationKeyById(
    row.conversation_id,
    row.key_id,
    userId
  );
  if (!entry) return { ...row, decryptFailed: true, content: "" };
  const payload = decryptPayload(row.content, entry);
  if (!payload) return { ...row, decryptFailed: true, content: "" };
  return { ...row, content: payload.t, reply_to: payload.r };
}
