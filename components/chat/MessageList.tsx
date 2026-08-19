"use client";

import { useEffect, useRef, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import type { Message, Profile } from "@/lib/types";

export function MessageList({
  messages,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  currentUserId,
  profilesById,
  isGroup,
  onReply,
  onCopy,
  onPin,
  onDelete,
  onEditSave,
  canAdminDelete = false,
}: {
  messages: Message[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  currentUserId: string;
  profilesById: Map<string, Profile>;
  isGroup: boolean;
  onReply?: (msg: Message) => void;
  onCopy?: (msg: Message) => void;
  onPin?: (msg: Message, pinned: boolean) => void;
  onDelete?: (msg: Message) => void;
  onEditSave?: (id: string, content: string) => void;
  canAdminDelete?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 40 && hasMore && !loadingMore) {
      onLoadMore();
    }
  }

  async function handleLoadMore() {
    const el = containerRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const prevTop = el?.scrollTop ?? 0;
    await onLoadMore();
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight + prevTop;
    });
  }

  // Auto-scroll to the bottom when new messages arrive (if already near bottom).
  useEffect(() => {
    const el = containerRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#efeae2] text-sm text-gray-500">
        <Spinner /> Loading messages…
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-[#efeae2] px-6 text-center">
        <div className="text-3xl">👋</div>
        <p className="text-sm text-gray-600">
          No messages yet. Say hello!
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 space-y-0.5 overflow-y-auto bg-[#efeae2] py-3"
    >
      {loadingMore && (
        <div className="flex justify-center py-2">
          <Spinner />
        </div>
      )}
      {hasMore && !loadingMore && (
        <div className="flex justify-center py-2">
          <button
            onClick={handleLoadMore}
            className="rounded-full bg-white px-3 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-100"
          >
            Load earlier messages
          </button>
        </div>
      )}
      {messages.map((msg) => {
        if (editingId === msg.id) {
          return (
            <EditMessageBox
              key={msg.id}
              initial={editText}
              onSave={(text) => {
                onEditSave?.(msg.id, text);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          );
        }
        const sender = msg.sender ?? profilesById.get(msg.sender_id);
        return (
          <MessageBubble
            key={msg.id}
            content={msg.content}
            createdAt={msg.created_at}
            isOwn={msg.sender_id === currentUserId}
            showSenderName={isGroup && msg.sender_id !== currentUserId}
            sender={sender}
            attachments={msg.attachments ?? []}
            replyTo={msg.reply_to}
            editedAt={msg.edited_at}
            deletedAt={msg.deleted_at}
            pinnedAt={msg.pinned_at}
            onReply={onReply ? () => onReply(msg) : undefined}
            onCopy={onCopy ? () => onCopy(msg) : undefined}
            onPin={onPin ? () => onPin(msg, !msg.pinned_at) : undefined}
            onEdit={
              onEditSave
                ? () => {
                    setEditText(msg.content);
                    setEditingId(msg.id);
                  }
                : undefined
            }
            onDelete={onDelete ? () => onDelete(msg) : undefined}
            canAdminDelete={canAdminDelete && msg.sender_id !== currentUserId}
            decryptFailed={msg.decryptFailed}
          />
        );
      })}
    </div>
  );
}

function EditMessageBox({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);

  return (
    <div className="flex justify-end px-3 py-0.5">
      <div className="w-full max-w-[78%] rounded-2xl rounded-br-md border border-blue-300 bg-white p-2 shadow-sm">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Edit message"
          className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-[15px] outline-none focus:border-blue-500"
        />
        <div className="mt-2 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={() => text.trim() && onSave(text.trim())}
            disabled={!text.trim()}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="mr-2 h-4 w-4 animate-spin text-gray-400"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}
