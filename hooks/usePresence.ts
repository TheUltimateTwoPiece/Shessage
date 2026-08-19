"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type PresencePayload = { user_id: string };

export function usePresence(userId: string | undefined) {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const channel = supabase.channel("presence-online");

    const applyState = () => {
      const state = channel.presenceState<PresencePayload>();
      const ids = new Set<string>();
      Object.values(state).forEach((presences) => {
        presences.forEach((p) => ids.add(p.user_id));
      });
      setOnlineIds(ids);
    };

    channel
      .on("presence", { event: "sync" }, applyState)
      .on("presence", { event: "join" }, ({ newPresences }) => {
        setOnlineIds((prev) => {
          const next = new Set(prev);
          (newPresences as unknown as PresencePayload[]).forEach((p) =>
            next.add(p.user_id)
          );
          return next;
        });
      })
      // Recompute from the full state on leave: a user with several tabs
      // closing one tab must not be marked offline while another is open.
      .on("presence", { event: "leave" }, applyState);

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel.track({ user_id: userId }).catch(() => {});
      }
    });

    return () => {
      channel.untrack().catch(() => {});
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const isOnline = useCallback((id: string) => onlineIds.has(id), [onlineIds]);

  return { onlineIds, isOnline };
}
