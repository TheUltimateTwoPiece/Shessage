"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useMessages } from "@/hooks/useMessages";
import { Avatar } from "../Avatar";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ScreenShareBar } from "./ScreenShareBar";
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
  const { messages, loading, loadingMore, hasMore, loadMore, appendMessage } =
    useMessages(conversation.id);
  const [sendError, setSendError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ReplyTo | null>(null);

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
  const avatarUrl = conversation.is_group ? null : others[0]?.avatar_url ?? null;
  const otherOnline =
    !conversation.is_group && others[0] ? isOnline(others[0].id) : false;

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

  async function sendMessage(
    text: string,
    attachments: Attachment[],
    reply: ReplyTo | null
  ) {
    setSendError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversation.id,
        sender_id: currentUser.id,
        content: text,
        attachments,
        reply_to: reply,
      })
      .select("*, sender:profiles(*)")
      .single();
    if (error || !data) {
      setSendError(error?.message ?? "Could not send the message.");
      return;
    }
    setReplyTo(null);
    appendMessage(data as Message);
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
        <Avatar name={title} url={avatarUrl} size="sm" showOnlineDot online={otherOnline} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-gray-900">{title}</div>
          <div className="truncate text-xs text-gray-500">
            {conversation.is_group
              ? `${participants.length} members`
              : otherOnline
                ? "online"
                : "offline"}
          </div>
        </div>
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
      />

      <MessageInput
        conversationId={conversation.id}
        currentUserId={currentUser.id}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onSend={sendMessage}
      />
    </div>
  );
}
