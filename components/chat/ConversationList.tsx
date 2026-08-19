"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "../Avatar";
import { NewConversationModal } from "./NewConversationModal";
import { NewGroupModal } from "./NewGroupModal";
import type { ConversationItem } from "@/hooks/useConversations";
import type { Profile } from "@/lib/types";
import { formatTimestamp } from "@/lib/utils";

export function ConversationList({
  items,
  loading,
  currentUser,
  isOnline,
  activeId,
  onSelect,
  onRefresh,
  onLogout,
}: {
  items: ConversationItem[];
  loading: boolean;
  currentUser: Profile;
  isOnline: (id: string) => boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const router = useRouter();
  const [showNewChat, setShowNewChat] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl font-extrabold tracking-tight text-blue-600">
            Shessage
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowNewChat(true)}
            title="New chat"
            aria-label="New chat"
            className="rounded-full p-2 text-gray-600 hover:bg-gray-100"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            onClick={() => setShowNewGroup(true)}
            title="New group"
            aria-label="New group"
            className="rounded-full p-2 text-gray-600 hover:bg-gray-100"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c.8-3.5 3.4-5 6.5-5s5.7 1.5 6.5 5" />
              <circle cx="17.5" cy="9" r="2.5" />
              <path d="M16 15.5c2.6.3 4.6 1.7 5.5 4.5" />
            </svg>
          </button>
          <button
            onClick={() => router.push("/settings")}
            title="Settings"
            aria-label="Settings"
            className="rounded-full p-2 text-gray-600 hover:bg-gray-100"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            onClick={onLogout}
            title="Log out"
            aria-label="Log out"
            className="rounded-full p-2 text-gray-600 hover:bg-gray-100"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
      </header>

      <div className="border-b border-gray-200 p-2">
        <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            readOnly
            placeholder="Search (use “New chat” to find people)"
            className="w-full bg-transparent text-sm text-gray-600 outline-none placeholder:text-gray-400"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-gray-500">
            Loading conversations…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <div className="text-3xl">💬</div>
            <p className="text-sm text-gray-600">No conversations yet.</p>
            <button
              onClick={() => setShowNewChat(true)}
              className="mt-1 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
            >
              Start a conversation
            </button>
          </div>
        ) : (
          items.map((item) => (
            <ConversationRow
              key={item.conversation.id}
              item={item}
              currentUserId={currentUser.id}
              isOnline={isOnline}
              active={item.conversation.id === activeId}
              onClick={() => onSelect(item.conversation.id)}
            />
          ))
        )}
      </div>

      <div className="border-t border-gray-200 p-2">
        <button
          onClick={() => router.push("/settings")}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-100"
        >
          <Avatar
            name={currentUser.display_name}
            url={currentUser.avatar_url}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-gray-900">
              {currentUser.display_name}
            </div>
            {currentUser.bio ? (
              <div className="truncate text-xs text-gray-500">
                {currentUser.bio}
              </div>
            ) : (
              <div className="text-xs text-gray-400">Tap to edit profile</div>
            )}
          </div>
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      {showNewChat && (
        <NewConversationModal
          currentUser={currentUser}
          onClose={() => setShowNewChat(false)}
          onStarted={(id) => {
            onRefresh();
            onSelect(id);
          }}
        />
      )}
      {showNewGroup && (
        <NewGroupModal
          currentUser={currentUser}
          onClose={() => setShowNewGroup(false)}
          onCreated={(id) => {
            onRefresh();
            onSelect(id);
          }}
        />
      )}
    </div>
  );
}

function ConversationRow({
  item,
  currentUserId,
  isOnline,
  active,
  onClick,
}: {
  item: ConversationItem;
  currentUserId: string;
  isOnline: (id: string) => boolean;
  active: boolean;
  onClick: () => void;
}) {
  const { conversation, lastMessage } = item;
  const participants = conversation.conversation_participants
    .map((p) => p.profiles)
    .filter((p): p is Profile => Boolean(p));
  const others = participants.filter((p) => p.id !== currentUserId);
  const title = conversation.is_group
    ? conversation.name ?? "Group"
    : others[0]?.display_name ?? "Unknown";
  const avatarUrl =
    conversation.avatar_url ??
    (conversation.is_group ? null : (others[0]?.avatar_url ?? null));
  const online = !conversation.is_group && others[0] ? isOnline(others[0].id) : false;
  const preview = lastMessage
    ? lastMessage.deleted_at
      ? "This message was deleted"
      : lastMessage.decryptFailed
        ? "🔒 Encrypted message"
        : lastMessage.content ||
          (lastMessage.attachments?.length
            ? `📎 ${lastMessage.attachments[0].name}`
            : "No messages yet")
    : "No messages yet";

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-100 ${
        active ? "bg-gray-100" : ""
      }`}
    >
      <Avatar name={title} url={avatarUrl} showOnlineDot online={online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium text-gray-900">{title}</span>
          {lastMessage && (
            <span className="shrink-0 text-[11px] text-gray-500">
              {formatTimestamp(lastMessage.created_at)}
            </span>
          )}
        </div>
        <div className="truncate text-sm text-gray-500">{preview}</div>
      </div>
    </button>
  );
}
