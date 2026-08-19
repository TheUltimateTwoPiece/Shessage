import { createClient } from "@/lib/supabase/client";

/**
 * Inserts participants one batch at a time, the current user first, so the RLS
 * insert policy (must already be a participant to add others) holds.
 */
async function addParticipants(conversationId: string, userIds: string[]) {
  const supabase = createClient();
  const unique = Array.from(new Set(userIds));
  const me = unique[0];
  const rest = unique.slice(1);

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

  const { data: conv, error } = await supabase
    .from("conversations")
    .insert({ is_group: false })
    .select()
    .single();
  if (error || !conv) {
    throw new Error(error?.message ?? "Could not create the conversation.");
  }

  await addParticipants(conv.id, [myId, otherId]);
  return conv.id;
}

export async function createGroupConversation(
  name: string,
  memberIds: string[]
): Promise<string> {
  const supabase = createClient();
  const { data: conv, error } = await supabase
    .from("conversations")
    .insert({ is_group: true, name: name || "Group" })
    .select()
    .single();
  if (error || !conv) {
    throw new Error(error?.message ?? "Could not create the group.");
  }

  await addParticipants(conv.id, memberIds);
  return conv.id;
}
