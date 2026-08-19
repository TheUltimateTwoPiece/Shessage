"use server";

import { AccessToken } from "livekit-server-sdk";
import { createClient } from "@/lib/supabase/server";

function livekitEnv() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    throw new Error(
      "LiveKit is not configured. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET and NEXT_PUBLIC_LIVEKIT_URL in .env.local"
    );
  }
  return { apiKey, apiSecret, url };
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

export async function getLiveKitToken(roomName: string, canPublish: boolean) {
  const { user } = await requireUser();
  const { apiKey, apiSecret, url } = livekitEnv();

  const at = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    ttl: "2h",
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
  });

  return { token: await at.toJwt(), livekitUrl: url, identity: user.id };
}

export async function startScreenShare(conversationId: string) {
  const { supabase, user } = await requireUser();
  const roomName = `conv_${conversationId}`;

  // Close any dangling share in this conversation (e.g. after a crash).
  await supabase
    .from("screen_shares")
    .update({ ended_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .is("ended_at", null);

  const { data, error } = await supabase
    .from("screen_shares")
    .insert({
      conversation_id: conversationId,
      sharer_id: user.id,
      room_name: roomName,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not start the screen share.");
  }

  const { token, livekitUrl } = await getLiveKitToken(roomName, true);
  return { screenShare: data, token, livekitUrl };
}

export async function stopScreenShare(conversationId: string) {
  await requireUser();
  const supabase = await createClient();
  await supabase
    .from("screen_shares")
    .update({ ended_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .is("ended_at", null);
  return { ok: true };
}
