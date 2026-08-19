"use client";

import { useState } from "react";
import { useUserSearch } from "@/hooks/useUserSearch";
import { createGroupConversation } from "@/lib/conversations";
import { Avatar } from "../Avatar";
import { Modal } from "./NewConversationModal";
import type { Profile } from "@/lib/types";

export function NewGroupModal({
  currentUser,
  onClose,
  onCreated,
}: {
  currentUser: Profile;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const { query, setQuery, results, searching } = useUserSearch(currentUser.id);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Map<string, Profile>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(user: Profile) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.set(user.id, user);
      return next;
    });
  }

  async function create() {
    if (selected.size < 2) {
      setError("A group needs at least 3 members (you + 2 others).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const conversationId = await createGroupConversation(
        name.trim(),
        [currentUser.id, ...Array.from(selected.keys())]
      );
      onCreated(conversationId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the group.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="New group">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Group name"
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
      />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Add members (search by name or email)…"
        className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
      />

      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Array.from(selected.values()).map((user) => (
            <span
              key={user.id}
              className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800"
            >
              {user.display_name}
              <button
                onClick={() => toggle(user)}
                aria-label={`Remove ${user.display_name}`}
                className="ml-0.5 font-bold text-emerald-600 hover:text-emerald-800"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-3 max-h-52 overflow-y-auto">
        {searching ? (
          <p className="px-1 py-2 text-sm text-gray-500">Searching…</p>
        ) : query.trim() && results.length === 0 ? (
          <p className="px-1 py-2 text-sm text-gray-500">No users found.</p>
        ) : (
          results.map((user) => {
            const isSelected = selected.has(user.id);
            return (
              <button
                key={user.id}
                onClick={() => toggle(user)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-100"
              >
                <Avatar name={user.display_name} url={user.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900">
                    {user.display_name}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    {user.email}
                  </div>
                </div>
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                    isSelected
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-gray-300 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>
            );
          })
        )}
      </div>

      <button
        onClick={create}
        disabled={busy}
        className="mt-4 w-full rounded-lg bg-emerald-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
      >
        {busy ? "Creating…" : `Create group (${selected.size + 1} members)`}
      </button>
    </Modal>
  );
}
