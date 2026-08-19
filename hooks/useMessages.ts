"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { decryptMessageRow } from "@/lib/e2ee";
import type { Message } from "@/lib/types";

export const PAGE_SIZE = 30;

export function useMessages(conversationId: string | null, userId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pinned, setPinned] = useState<Message | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [count, setCount] = useState(0);

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) =>
      prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
    );
  }, []);

  const applyUpdate = useCallback((updated: Message) => {
    setMessages((prev) =>
      prev.some((m) => m.id === updated.id)
        ? prev.map((m) => (m.id === updated.id ? updated : m))
        : prev
    );
    setPinned((prev) => {
      if (updated.deleted_at) return prev?.id === updated.id ? null : prev;
      if (updated.pinned_at) {
        return prev?.pinned_at && prev.pinned_at >= updated.pinned_at
          ? prev
          : updated;
      }
      return prev?.id === updated.id ? null : prev;
    });
  }, []);

  const decryptAll = useCallback(
    async (rows: Message[]): Promise<Message[]> =>
      Promise.all(rows.map((m) => decryptMessageRow(m, userId))),
    [userId]
  );

  const loadMore = useCallback(async () => {
    if (!conversationId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("messages")
      .select("*, sender:profiles(*)")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .range(count, count + PAGE_SIZE - 1);
    if (!error && data) {
      const fresh = await decryptAll((data as Message[]).slice().reverse());
      setMessages((prev) => {
        // Realtime messages may have arrived since the last fetch, shifting the
        // offset — drop any ids we already have to avoid duplicates.
        const existing = new Set(prev.map((m) => m.id));
        return [...fresh.filter((m) => !existing.has(m.id)), ...prev];
      });
      setCount((c) => c + data.length);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }, [conversationId, count, hasMore, loadingMore, decryptAll]);

  // Initial load. The component is keyed by conversation id, so this hook
  // remounts per conversation and starts with fresh, empty state.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();
    const msgs = supabase
      .from("messages")
      .select("*, sender:profiles(*)")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .range(0, PAGE_SIZE - 1);
    const pinnedQ = supabase
      .from("messages")
      .select("*, sender:profiles(*)")
      .eq("conversation_id", conversationId)
      .not("pinned_at", "is", null)
      .order("pinned_at", { ascending: false })
      .limit(1);
    Promise.all([msgs, pinnedQ]).then(async ([mRes, pRes]) => {
      if (!mRes.error && mRes.data) {
        const rows = (mRes.data as Message[]).slice().reverse();
        const decrypted = await decryptAll(rows);
        setMessages(decrypted);
        setCount(mRes.data.length);
        setHasMore(mRes.data.length === PAGE_SIZE);
      }
      if (!pRes.error && pRes.data?.[0]) {
        const [decryptedPinned] = await decryptAll([pRes.data[0] as Message]);
        setPinned(decryptedPinned);
      }
      setLoading(false);
    });
  }, [conversationId, decryptAll]);

  // Realtime: append new messages, and apply edit/delete/pin updates live.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          decryptMessageRow(payload.new as Message, userId).then((m) =>
            appendMessage(m)
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          decryptMessageRow(payload.new as Message, userId).then((m) =>
            applyUpdate(m)
          );
        }
      );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, userId, appendMessage, applyUpdate]);

  return { messages, pinned, loading, loadingMore, hasMore, loadMore, appendMessage };
}
