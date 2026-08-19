export type Profile = {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  is_group: boolean;
  name: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  last_message_at: string;
};

export type GroupRole = "owner" | "admin" | "member";

export type ParticipantRow = {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  role: GroupRole;
  profiles: Profile | null;
};

export type ConversationWithParticipants = Conversation & {
  conversation_participants: ParticipantRow[];
};

export type Attachment = {
  path: string;
  url: string;
  name: string;
  size: number;
  mime: string;
};

export type ReplyTo = {
  id: string;
  sender_name: string;
  content: string;
  attachment_name: string | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  attachments: Attachment[];
  key_id?: string | null;
  reply_to?: ReplyTo | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  pinned_at?: string | null;
  sender?: Profile | null;
  /** Set when a message can't be decrypted (e.g. a device that joined late). */
  decryptFailed?: boolean;
};

export type ScreenShare = {
  id: string;
  conversation_id: string;
  sharer_id: string;
  room_name: string;
  started_at: string;
  ended_at: string | null;
};
