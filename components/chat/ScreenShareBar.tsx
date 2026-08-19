"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  TrackLoop,
  useRoomContext,
  useTracks,
  VideoTrack,
} from "@livekit/components-react";
import {
  ConnectionState,
  RoomEvent,
  Track,
  createLocalScreenTracks,
  type LocalTrack,
} from "livekit-client";
import { createClient } from "@/lib/supabase/client";
import {
  getLiveKitToken,
  startScreenShare,
  stopScreenShare,
} from "@/app/actions/livekit";
import type { ScreenShare } from "@/lib/types";

type Role = "idle" | "sharing" | "viewing";
type ConnStatus = "idle" | "connecting" | "live" | "error";

function ScreenShareVideo() {
  const tracks = useTracks([Track.Source.ScreenShare]);
  if (tracks.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
        Waiting for the screen share…
      </div>
    );
  }
  return (
    <TrackLoop tracks={tracks}>
      <VideoTrack className="h-full w-full object-contain" />
    </TrackLoop>
  );
}

/** Publishes the local screen capture once the LiveKit room is connected. */
function SharerTracks() {
  const room = useRoomContext();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let tracks: LocalTrack[] = [];
    let cancelled = false;

    const start = async () => {
      try {
        tracks = await createLocalScreenTracks();
        if (cancelled) {
          tracks.forEach((t) => t.stop());
          return;
        }
        await Promise.all(
          tracks.map((t) => room.localParticipant.publishTrack(t))
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not start screen capture. Check your browser permissions."
          );
        }
      }
    };

    if (room.state === ConnectionState.Connected) {
      start();
    } else {
      room.once(RoomEvent.Connected, start);
    }

    return () => {
      cancelled = true;
      room.off(RoomEvent.Connected, start);
      tracks.forEach((t) => t.stop());
    };
  }, [room]);

  return (
    <>
      {error && (
        <div className="absolute inset-x-0 top-0 bg-red-600 px-3 py-1.5 text-center text-xs font-medium text-white">
          {error} — click “Stop sharing” to dismiss.
        </div>
      )}
      <ScreenShareVideo />
    </>
  );
}

export function ScreenShareBar({
  conversationId,
  currentUserId,
  getDisplayName,
}: {
  conversationId: string | null;
  currentUserId: string | undefined;
  getDisplayName: (userId: string) => string | null;
}) {
  const [role, setRole] = useState<Role>("idle");
  const [connStatus, setConnStatus] = useState<ConnStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conn, setConn] = useState<{ token: string; url: string } | null>(null);
  const [sharerId, setSharerId] = useState<string | null>(null);

  const roleRef = useRef<Role>("idle");
  const conversationIdRef = useRef(conversationId);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);
  // Read the ref through a function so TypeScript doesn’t narrow it (the ref
  // is updated from an effect, so narrowing it to its initial value is wrong).
  const getRole = () => roleRef.current;

  const cleanup = useCallback(() => {
    setRole("idle");
    setConn(null);
    setSharerId(null);
    setConnStatus("idle");
    setError(null);
  }, []);

  const handleShareEvent = useCallback(
    async (share: ScreenShare) => {
      if (share.ended_at) {
        cleanup();
        return;
      }
      setSharerId(share.sharer_id);
      if (share.sharer_id === currentUserId) {
        setRole("sharing");
        return;
      }
      if (getRole() !== "idle") return;

      // Someone else is sharing — join as a viewer.
      setRole("viewing");
      setConnStatus("connecting");
      try {
        const { token, livekitUrl } = await getLiveKitToken(share.room_name, false);
        // The share may have ended while we were fetching the token.
        if (getRole() !== "viewing") return;
        setConn({ token, url: livekitUrl });
        setConnStatus("live");
      } catch (err) {
        setConnStatus("error");
        setError(
          err instanceof Error
            ? err.message
            : "Could not connect to the screen share."
        );
        setRole("idle");
        setConn(null);
      }
    },
    [currentUserId, cleanup]
  );

  // Realtime: react to screen-share rows for this conversation.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`screen-shares:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "screen_shares",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          handleShareEvent(payload.new as ScreenShare);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "screen_shares",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          handleShareEvent(payload.new as ScreenShare);
        }
      );
    channel.subscribe();
    return () => {
      cleanup();
      supabase.removeChannel(channel);
    };
  }, [conversationId, handleShareEvent, cleanup]);

  const startSharing = useCallback(async () => {
    const cid = conversationIdRef.current;
    if (!cid) return;
    setError(null);
    setConnStatus("connecting");
    try {
      const { token, livekitUrl } = await startScreenShare(cid);
      setConn({ token, url: livekitUrl });
      setRole("sharing");
      setConnStatus("live");
    } catch (err) {
      setConnStatus("error");
      setError(
        err instanceof Error ? err.message : "Could not start screen sharing."
      );
      setRole("idle");
      setConn(null);
    }
  }, []);

  const stopSharing = useCallback(async () => {
    const cid = conversationIdRef.current;
    if (cid) stopScreenShare(cid).catch(() => {});
    cleanup();
  }, [cleanup]);

  const handleDisconnected = useCallback(() => {
    const cid = conversationIdRef.current;
    const wasActive = roleRef.current === "sharing" || roleRef.current === "viewing";
    cleanup();
    if (wasActive && cid) {
      // The LiveKit room went away (e.g. the sharer closed their tab) —
      // close the dangling row so everyone else resets too.
      stopScreenShare(cid).catch(() => {});
    }
  }, [cleanup]);

  if (!conversationId) return null;

  return (
    <div className="border-b border-gray-200 bg-gray-50 px-3 py-2">
      {error && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="shrink-0 font-semibold text-red-600 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {role === "idle" && !error && (
        <button
          onClick={startSharing}
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
        >
          <MonitorIcon />
          Share screen
        </button>
      )}

      {(role === "sharing" || role === "viewing") && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
              {role === "sharing" ? (
                <>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                  You are sharing your screen
                </>
              ) : (
                <>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                  Watching {getDisplayName(sharerId ?? "") ?? "their"} screen
                </>
              )}
              {connStatus === "connecting" && (
                <span className="text-xs font-normal text-gray-500">
                  (connecting…)
                </span>
              )}
            </span>
            <button
              onClick={stopSharing}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-white transition-colors ${
                role === "sharing"
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-gray-500 hover:bg-gray-600"
              }`}
            >
              {role === "sharing" ? "Stop sharing" : "Leave"}
            </button>
          </div>

          {conn && (
            <LiveKitRoom
              token={conn.token}
              serverUrl={conn.url}
              connect={true}
              video={false}
              audio={false}
              onDisconnected={handleDisconnected}
              onError={(err) => {
                setConnStatus("error");
                setError(
                  err?.message || "The LiveKit connection failed. Please try again."
                );
                setRole("idle");
                setConn(null);
              }}
              className="relative aspect-video w-full overflow-hidden rounded-lg bg-black"
            >
              <RoomAudioRenderer />
              {role === "sharing" ? <SharerTracks /> : <ScreenShareVideo />}
            </LiveKitRoom>
          )}
        </div>
      )}
    </div>
  );
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
