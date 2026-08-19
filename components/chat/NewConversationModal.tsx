"use client";

import { useState } from "react";
import { useUserSearch } from "@/hooks/useUserSearch";
import { findOrCreateDirectConversation } from "@/lib/conversations";
import { ensureConversationKey } from "@/lib/e2ee";
import { Avatar } from "../Avatar";
import type { Profile } from "@/lib/types";

export function NewConversationModal({
  currentUser,
  onClose,
  onStarted,
}: {
  currentUser: Profile;
  onClose: () => void;
  onStarted: (conversationId: string) => void;
}) {
  const { query, setQuery, results, searching } = useUserSearch(currentUser.id);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function startWith(user: Profile) {
    setBusyId(user.id);
    setError(null);
    try {
      const conversationId = await findOrCreateDirectConversation(
        currentUser.id,
        user.id
      );
      // Create the conversation key and wrap it for every participant's
      // device so both sides can encrypt/decrypt from the first message.
      await ensureConversationKey(conversationId, currentUser.id);
      onStarted(conversationId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the conversation.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal onClose={onClose} title="New chat">
      <input
        autoFocus
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email…"
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
      />

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-3 max-h-72 overflow-y-auto">
        {searching ? (
          <p className="px-1 py-2 text-sm text-gray-500">Searching…</p>
        ) : query.trim() && results.length === 0 ? (
          <p className="px-1 py-2 text-sm text-gray-500">No users found.</p>
        ) : (
          results.map((user) => (
            <button
              key={user.id}
              onClick={() => startWith(user)}
              disabled={busyId === user.id}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-100 disabled:opacity-50"
            >
              <Avatar name={user.display_name} url={user.avatar_url} />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-900">
                  {user.display_name}
                </div>
                <div className="truncate text-xs text-gray-500">{user.email}</div>
              </div>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
