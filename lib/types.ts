export type Profile = {
  id: string;
  email: string | null;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  is_group: boolean;
  name: string | null;
  created_at: string;
  last_message_at: string;
};

export type ParticipantRow = {
  conversation_id: string;
  user_id: string;
  joined_at: string;
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

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  attachments: Attachment[];
  sender?: Profile | null;
};

export type ScreenShare = {
  id: string;
  conversation_id: string;
  sharer_id: string;
  room_name: string;
  started_at: string;
  ended_at: string | null;
};
