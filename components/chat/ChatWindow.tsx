"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useMessages } from "@/hooks/useMessages";
import {
  decryptPayload,
  encryptPayload,
  ensureConversationKey,
  getConversationKeyById,
} from "@/lib/e2ee";
import { Avatar } from "../Avatar";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ScreenShareBar } from "./ScreenShareBar";
import { GroupInfoModal } from "./GroupInfoModal";
import type {
  Attachment,
  ConversationWithParticipants,
  Message,
  Profile,
  ReplyTo,
} from "@/lib/types";

export function ChatWindow({
  conversation,
  currentUser,
  isOnline,
  onBack,
}: {
  conversation: ConversationWithParticipants;
  currentUser: Profile;
  isOnline: (id: string) => boolean;
  onBack: () => void;
}) {
  const { messages, pinned, loading, loadingMore, hasMore, loadMore, appendMessage } =
    useMessages(conversation.id, currentUser.id);
  const [sendError, setSendError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);

  const participants = useMemo(
    () =>
      conversation.conversation_participants
        .map((p) => p.profiles)
        .filter((p): p is Profile => Boolean(p)),
    [conversation]
  );
  const profilesById = useMemo(
    () => new Map(participants.map((p) => [p.id, p])),
    [participants]
  );
  const others = participants.filter((p) => p.id !== currentUser.id);
  const title = conversation.is_group
    ? conversation.name ?? "Group"
    : others[0]?.display_name ?? "Unknown";
  const avatarUrl = conversation.is_group
    ? conversation.avatar_url
    : (others[0]?.avatar_url ?? null);
  const otherOnline =
    !conversation.is_group && others[0] ? isOnline(others[0].id) : false;
  const myRole =
    conversation.conversation_participants.find(
      (p) => p.user_id === currentUser.id
    )?.role ?? "member";
  const isGroupAdmin = conversation.is_group && myRole !== "member";

  // Make sure this device has a conversation key (creating + wrapping one for
  // every participant if it doesn't) so sending works and new messages are
  // decryptable by everyone.
  useEffect(() => {
    ensureConversationKey(conversation.id, currentUser.id).catch(() => {});
  }, [conversation.id, currentUser.id]);

  function handleReply(msg: Message) {
    const senderName =
      msg.sender_id === currentUser.id
        ? "You"
        : profilesById.get(msg.sender_id)?.display_name ?? "Unknown";
    setReplyTo({
      id: msg.id,
      sender_name: senderName,
      content: msg.content,
      attachment_name: msg.attachments?.[0]?.name ?? null,
    });
  }

  function handleCopy(msg: Message) {
    navigator.clipboard?.writeText(msg.content).catch(() => {});
  }

  async function runRpc(
    fn: () => PromiseLike<{ error: { message: string } | null }>
  ) {
    const { error } = await fn();
    if (error) setSendError(error.message);
  }

  async function handlePin(msg: Message, pinnedValue: boolean) {
    const supabase = createClient();
    await runRpc(() =>
      supabase.rpc("pin_message", { p_message_id: msg.id, p_pinned: pinnedValue })
    );
  }

  async function handleDelete(msg: Message) {
    if (!window.confirm("Delete this message for everyone?")) return;
    const supabase = createClient();
    if (msg.sender_id === currentUser.id) {
      await runRpc(() =>
        supabase.rpc("delete_message", { p_message_id: msg.id })
      );
    } else if (isGroupAdmin) {
      await runRpc(() =>
        supabase.rpc("delete_any_message", { p_message_id: msg.id })
      );
    }
  }

  async function handleEditSave(id: string, content: string) {
    const supabase = createClient();
    // Encrypt with the SAME key generation the message was sent with, so
    // everyone who could read the original can read the edit.
    const original = messages.find((m) => m.id === id);
    const entry =
      (original?.key_id
        ? await getConversationKeyById(
            conversation.id,
            original.key_id,
            currentUser.id
          )
        : null) ??
      (await ensureConversationKey(conversation.id, currentUser.id));
    const ciphertext = encryptPayload(
      { t: content, r: original?.reply_to ?? null },
      entry
    );
    await runRpc(() =>
      supabase.rpc("edit_message", {
        p_message_id: id,
        p_content: ciphertext,
      })
    );
  }

  async function sendMessage(
    text: string,
    attachments: Attachment[],
    reply: ReplyTo | null
  ) {
    setSendError(null);
    const supabase = createClient();
    const entry = await ensureConversationKey(conversation.id, currentUser.id);
    // Only ciphertext ever reaches the server.
    const content = encryptPayload({ t: text, r: reply }, entry);
    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversation.id,
        sender_id: currentUser.id,
        content,
        key_id: entry.keyId,
        attachments,
      })
      .select("*, sender:profiles(*)")
      .single();
    if (error || !data) {
      setSendError(error?.message ?? "Could not send the message.");
      return;
    }
    const row = data as Message;
    const decrypted =
      decryptPayload(row.content, entry) ?? { t: "", r: null };
    setReplyTo(null);
    appendMessage({ ...row, content: decrypted.t, reply_to: decrypted.r });
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2.5">
        <button
          onClick={onBack}
          aria-label="Back to conversations"
          className="rounded-full p-1.5 text-gray-600 hover:bg-gray-200 md:hidden"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <span
          title="End-to-end encrypted — only you and the other participants can read these messages"
          className="shrink-0 text-base"
          aria-label="End-to-end encrypted"
        >
          🔒
        </span>
        <button
          onClick={conversation.is_group ? () => setShowGroupInfo(true) : undefined}
          className={`flex min-w-0 flex-1 items-center gap-3 text-left ${
            conversation.is_group ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <Avatar name={title} url={avatarUrl} size="sm" showOnlineDot online={otherOnline} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-gray-900">{title}</div>
            <div className="truncate text-xs text-gray-500">
              {conversation.is_group
                ? `${participants.length} members${isGroupAdmin ? " · tap for info" : ""}`
                : otherOnline
                  ? "online"
                  : "offline"}
            </div>
          </div>
        </button>
      </header>

      <ScreenShareBar
        conversationId={conversation.id}
        currentUserId={currentUser.id}
        getDisplayName={(id) => profilesById.get(id)?.display_name ?? null}
      />

      {sendError && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {sendError}
        </div>
      )}

      {pinned && !pinned.deleted_at && (
        <div className="flex items-center gap-2 border-b border-gray-200 bg-blue-50 px-3 py-2 text-sm">
          <span aria-hidden>📌</span>
          <div className="min-w-0 flex-1 truncate">
            <span className="font-semibold text-blue-700">
              {profilesById.get(pinned.sender_id)?.display_name ?? "Unknown"}
              {": "}
            </span>
            <span className="text-gray-600">
              {pinned.content ||
                (pinned.attachments?.[0]
                  ? `📎 ${pinned.attachments[0].name}`
                  : "Message")}
            </span>
          </div>
          <button
            onClick={() => handlePin(pinned, false)}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
          >
            Unpin
          </button>
        </div>
      )}

      <MessageList
        messages={messages}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        onLoadMore={loadMore}
        currentUserId={currentUser.id}
        profilesById={profilesById}
        isGroup={conversation.is_group}
        onReply={handleReply}
        onCopy={handleCopy}
        onPin={handlePin}
        onDelete={handleDelete}
        onEditSave={handleEditSave}
        canAdminDelete={isGroupAdmin}
      />

      <MessageInput
        conversationId={conversation.id}
        currentUserId={currentUser.id}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onSend={sendMessage}
      />

      {showGroupInfo && (
        <GroupInfoModal
          conversation={conversation}
          currentUser={currentUser}
          onClose={() => setShowGroupInfo(false)}
        />
      )}
    </div>
  );
}
