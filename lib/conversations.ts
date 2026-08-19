import { createClient } from "@/lib/supabase/client";

export async function findOrCreateDirectConversation(
  _myId: string,
  otherId: string
): Promise<string> {
  const supabase = createClient();
  // Server-side find-or-create: reuses an existing 1:1 or creates one with
  // both members. Routing through the RPC means users can't add themselves
  // to conversations they aren't part of.
  const { data, error } = await supabase.rpc("create_direct_conversation", {
    p_other_id: otherId,
  });
  if (error || !data) {
    throw new Error(error?.message ?? "Could not start the conversation.");
  }
  return data as string;
}

export async function createGroupConversation(
  name: string,
  memberIds: string[]
): Promise<string> {
  const supabase = createClient();
  // Server-side RPC: creates the conversation, makes the caller the owner,
  // and adds everyone else as members — bypassing the member-only insert
  // policy while keeping the rest of the group creation secure.
  const { data, error } = await supabase.rpc("create_group", {
    p_name: name || "Group",
    p_member_ids: memberIds,
  });
  if (error || !data) {
    throw new Error(error?.message ?? "Could not create the group.");
  }
  return data as string;
}
