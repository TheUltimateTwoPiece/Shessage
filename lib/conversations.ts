import { createClient } from "@/lib/supabase/client";

/**
 * Inserts participants one batch at a time, the current user first, so the RLS
 * insert policy (must already be a participant to add others) holds.
 */
async function addParticipants(conversationId: string, userIds: string[]) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const me = user?.id;
  const rest = Array.from(new Set(userIds.filter((id) => id && id !== me)));

  if (me) {
    const { error } = await supabase
      .from("conversation_participants")
      .insert({ conversation_id: conversationId, user_id: me });
    if (error) throw new Error(error.message);
  }
  if (rest.length > 0) {
    const { error } = await supabase
      .from("conversation_participants")
      .insert(
        rest.map((user_id) => ({ conversation_id: conversationId, user_id }))
      );
    if (error) throw new Error(error.message);
  }
}

export async function findOrCreateDirectConversation(
  myId: string,
  otherId: string
): Promise<string> {
  const supabase = createClient();

  // Reuse an existing 1:1 conversation if one already exists.
  const { data: convs } = await supabase
    .from("conversations")
    .select("id, is_group, conversation_participants(user_id)")
    .eq("is_group", false);

  const existing = (convs ?? []).find((c) => {
    const ids = c.conversation_participants.map((p) => p.user_id);
    return (
      ids.includes(myId) && ids.includes(otherId) && ids.length === 2
    );
  });
  if (existing) return existing.id;

  // Generate the id client-side so we don't have to SELECT the row back: a
  // brand-new conversation is invisible to the user (RLS) until they're added
  // as a participant, so `insert().select()` would return nothing.
  const conversationId = crypto.randomUUID();

  const { error } = await supabase
    .from("conversations")
    .insert({ id: conversationId, is_group: false });
  if (error) throw new Error(error.message);

  await addParticipants(conversationId, [myId, otherId]);
  return conversationId;
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
