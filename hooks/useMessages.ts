"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/lib/types";

export const PAGE_SIZE = 30;

export function useMessages(conversationId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [count, setCount] = useState(0);

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) =>
      prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
    );
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
    supabase
      .from("messages")
      .select("*, sender:profiles(*)")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .range(0, PAGE_SIZE - 1)
      .then(({ data, error }) => {
        if (!error && data) {
          setMessages((data as Message[]).slice().reverse());
          setCount(data.length);
          setHasMore(data.length === PAGE_SIZE);
        }
        setLoading(false);
      });
  }, [conversationId]);

  // Realtime: append new messages as they arrive.
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
      );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, appendMessage]);

  return { messages, loading, loadingMore, hasMore, loadMore, appendMessage };
}
