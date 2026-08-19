"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ConversationWithParticipants, Message } from "@/lib/types";

export type ConversationItem = {
  conversation: ConversationWithParticipants;
  lastMessage: Message | null;
};

function sortByActivity(items: ConversationItem[]): ConversationItem[] {
  return items.slice().sort((a, b) => {
    const ta = a.lastMessage?.created_at ?? a.conversation.last_message_at;
    const tb = b.lastMessage?.created_at ?? b.conversation.last_message_at;
    return new Date(tb).getTime() - new Date(ta).getTime();
  });
}

export function useConversations(userId: string | undefined) {
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef(userId);

  const load = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    setLoading(true);
    const supabase = createClient();

    const { data: parts } = await supabase
      .from("conversation_participants")
      .select("conversation_id")
      .eq("user_id", uid);

    const ids = (parts ?? []).map((p) => p.conversation_id);
    if (ids.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    const [convRes, msgRes] = await Promise.all([
      supabase
        .from("conversations")
        .select("*, conversation_participants(profiles(*))")
        .in("id", ids),
      supabase
        .from("messages")
        .select("id, conversation_id, sender_id, content, created_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false }),
    ]);

    const conversations = (convRes.data ?? []) as ConversationWithParticipants[];
    const lastByConv = new Map<string, Message>();
    for (const m of msgRes.data ?? []) {
      if (!lastByConv.has(m.conversation_id)) lastByConv.set(m.conversation_id, m);
    }

    setItems(
      sortByActivity(
        conversations.map((conversation) => ({
          conversation,
          lastMessage: lastByConv.get(conversation.id) ?? null,
        }))
      )
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    userIdRef.current = userId;
    if (userId) load();
  }, [userId, load]);

  // Realtime: new conversations (you were added) + new messages (preview/order).
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase
      .channel("conversations-live")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_participants",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          load();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          setItems((prev) => {
            const exists = prev.some((i) => i.conversation.id === msg.conversation_id);
            if (!exists) return prev;
            return sortByActivity(
              prev.map((i) =>
                i.conversation.id === msg.conversation_id ? { ...i, lastMessage: msg } : i
              )
            );
          });
        }
      );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, load]);

  return { items, loading, refresh: load };
}
