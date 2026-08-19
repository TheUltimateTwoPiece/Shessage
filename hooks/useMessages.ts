"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/lib/types";

export const PAGE_SIZE = 30;

export function useMessages(conversationId: string | null) {
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
      setMessages((prev) => {
        // Realtime messages may have arrived since the last fetch, shifting the
        // offset — drop any ids we already have to avoid duplicates.
        const existing = new Set(prev.map((m) => m.id));
        const fresh = (data as Message[])
          .slice()
          .reverse()
          .filter((m) => !existing.has(m.id));
        return [...fresh, ...prev];
      });
      setCount((c) => c + data.length);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }, [conversationId, count, hasMore, loadingMore]);

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
    Promise.all([msgs, pinnedQ]).then(([mRes, pRes]) => {
      if (!mRes.error && mRes.data) {
        setMessages((mRes.data as Message[]).slice().reverse());
        setCount(mRes.data.length);
        setHasMore(mRes.data.length === PAGE_SIZE);
      }
      if (!pRes.error && pRes.data?.[0]) {
        setPinned(pRes.data[0] as Message);
      }
      setLoading(false);
    });
  }, [conversationId]);

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
          appendMessage(payload.new as Message);
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
          applyUpdate(payload.new as Message);
        }
      );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, appendMessage, applyUpdate]);

  return { messages, pinned, loading, loadingMore, hasMore, loadMore, appendMessage };
}
