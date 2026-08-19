"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useConversations } from "@/hooks/useConversations";
import { usePresence } from "@/hooks/usePresence";
import { ConversationList } from "./ConversationList";
import { ChatWindow } from "./ChatWindow";
import type { Profile } from "@/lib/types";

export function ChatApp() {
  const router = useRouter();
  const [user, setUser] = useState<Profile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) {
        router.replace("/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .single();
      setUser(
        (profile as Profile) ?? {
          id: authUser.id,
          email: authUser.email ?? null,
          display_name: authUser.email?.split("@")[0] ?? "User",
          avatar_url: null,
          created_at: authUser.created_at,
        }
      );
      setAuthLoading(false);
    })();
  }, [router]);

  const { items, loading, refresh } = useConversations(user?.id);
  const { isOnline } = usePresence(user?.id);

  const activeConversation = useMemo(
    () => items.find((i) => i.conversation.id === activeId)?.conversation ?? null,
    [items, activeId]
  );
  const pendingActive = activeId !== null && !activeConversation;

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  if (authLoading || !user) {
    return (
      <div className="flex h-dvh items-center justify-center bg-white text-sm text-gray-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-white">
      {/* Conversation list — hidden on mobile when a chat is open */}
      <aside
        className={`${
          activeConversation ? "hidden" : "flex"
        } w-full flex-col border-r border-gray-200 md:flex md:w-80 md:shrink-0`}
      >
        <ConversationList
          items={items}
          loading={loading}
          currentUser={user}
          isOnline={isOnline}
          activeId={activeId}
          onSelect={setActiveId}
          onRefresh={refresh}
          onLogout={handleLogout}
        />
      </aside>

      {/* Active conversation — hidden on mobile until one is selected */}
      <main
        className={`${
          activeConversation ? "flex" : "hidden"
        } min-w-0 flex-1 flex-col md:flex`}
      >
        {activeConversation ? (
          <ChatWindow
            key={activeConversation.id}
            conversation={activeConversation}
            currentUser={user}
            isOnline={isOnline}
            onBack={() => setActiveId(null)}
          />
        ) : pendingActive ? (
          <div className="flex flex-1 items-center justify-center bg-white text-sm text-gray-500">
            Opening conversation…
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#efeae2] px-6 text-center">
            <div className="text-5xl">💬</div>
            <h2 className="text-lg font-semibold text-gray-700">Welcome to Shessage</h2>
            <p className="max-w-sm text-sm text-gray-500">
              Select a conversation on the left, or start a new chat to message
              someone in real time. You can even share your screen in any
              conversation.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
