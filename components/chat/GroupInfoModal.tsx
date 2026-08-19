"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadGroupAvatar } from "@/lib/attachments";
import { rotateConversationKey } from "@/lib/e2ee";
import { Avatar } from "../Avatar";
import { Modal } from "./NewConversationModal";
import type {
  ConversationWithParticipants,
  GroupRole,
  ParticipantRow,
  Profile,
} from "@/lib/types";

const ROLE_LABEL: Record<GroupRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function GroupInfoModal({
  conversation,
  currentUser,
  onClose,
}: {
  conversation: ConversationWithParticipants;
  currentUser: Profile;
  onClose: () => void;
}) {
  const [name, setName] = useState(conversation.name ?? "");
  const [bio, setBio] = useState(conversation.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(conversation.avatar_url ?? null);
  const [members, setMembers] = useState<ParticipantRow[]>(
    conversation.conversation_participants
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const myRole = members.find((m) => m.user_id === currentUser.id)?.role ?? "member";
  const isAdmin = myRole === "owner" || myRole === "admin";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function saveInfo() {
    const supabase = createClient();
    await run(async () => {
      const { error } = await supabase.rpc("update_group_info", {
        p_conversation_id: conversation.id,
        p_name: name,
        p_bio: bio,
        p_avatar_url: avatarUrl,
      });
      if (error) throw new Error(error.message);
    });
  }

  function pickAvatar(list: FileList | null) {
    const f = list?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError("The image must be under 5 MB.");
      return;
    }
    setError(null);
    run(async () => {
      const url = await uploadGroupAvatar(f, conversation.id);
      setAvatarUrl(url);
      const supabase = createClient();
      const { error } = await supabase.rpc("update_group_info", {
        p_conversation_id: conversation.id,
        p_name: name,
        p_bio: bio,
        p_avatar_url: url,
      });
      if (error) throw new Error(error.message);
    });
  }

  async function setRole(member: ParticipantRow, role: GroupRole) {
    const supabase = createClient();
    await run(async () => {
      const { error } = await supabase.rpc("set_member_role", {
        p_conversation_id: conversation.id,
        p_user_id: member.user_id,
        p_role: role,
      });
      if (error) throw new Error(error.message);
      setMembers((prev) =>
        prev.map((m) => (m.user_id === member.user_id ? { ...m, role } : m))
      );
    });
  }

  async function removeMember(member: ParticipantRow) {
    const supabase = createClient();
    await run(async () => {
      // Rotate the conversation key BEFORE removing them, wrapped to everyone
      // except the departing member, so they can't read future messages.
      await rotateConversationKey(conversation.id, currentUser.id, [
        member.user_id,
      ]);
      const { error } = await supabase.rpc("remove_member", {
        p_conversation_id: conversation.id,
        p_user_id: member.user_id,
      });
      if (error) throw new Error(error.message);
      setMembers((prev) => prev.filter((m) => m.user_id !== member.user_id));
    });
  }

  async function leaveGroup() {
    if (!window.confirm("Leave this group? You won’t be able to read new messages.")) {
      return;
    }
    const supabase = createClient();
    await run(async () => {
      // Rotate the key for everyone else, then remove yourself.
      await rotateConversationKey(conversation.id, currentUser.id, [
        currentUser.id,
      ]);
      const { error } = await supabase.rpc("remove_member", {
        p_conversation_id: conversation.id,
        p_user_id: currentUser.id,
      });
      if (error) throw new Error(error.message);
      onClose();
    });
  }

  function canManage(target: ParticipantRow): boolean {
    if (!isAdmin || target.user_id === currentUser.id) return false;
    if (myRole === "owner") return target.role !== "owner";
    return target.role === "member"; // admins manage members only
  }

  return (
    <Modal onClose={onClose} title="Group info">
      <div className="mb-4 flex flex-col items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!isAdmin || busy}
          aria-label="Change group picture"
          className="group relative disabled:cursor-default"
        >
          <Avatar name={name || "Group"} url={avatarUrl} size="lg" />
          {isAdmin && (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
              Change
            </span>
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pickAvatar(e.target.files)}
        />
        {isAdmin && (
          <p className="text-xs text-gray-500">
            Tap the avatar to change the group picture
          </p>
        )}
      </div>

      <label className="mb-1 block text-sm font-medium text-gray-700">
        Group name
      </label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={!isAdmin || busy}
        maxLength={40}
        className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
      />

      <label className="mb-1 block text-sm font-medium text-gray-700">
        Group bio
      </label>
      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        disabled={!isAdmin || busy}
        maxLength={160}
        rows={2}
        placeholder={isAdmin ? "Describe the group…" : "No bio yet"}
        className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
      />

      {isAdmin && (
        <button
          onClick={saveInfo}
          disabled={busy}
          className="mt-3 w-full rounded-lg bg-blue-500 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save group info"}
        </button>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          Saved!
        </div>
      )}

      <div className="mt-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-700">
          {members.length} members
        </h3>
        {myRole !== "owner" && (
          <button
            onClick={leaveGroup}
            disabled={busy}
            className="mt-3 w-full rounded-lg border border-red-300 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Leave group
          </button>
        )}
        <div className="max-h-56 overflow-y-auto">
          {members.map((member) => {
            const profile = member.profiles;
            const manage = canManage(member);
            return (
              <div
                key={member.user_id}
                className="flex items-center gap-3 rounded-lg px-2 py-2"
              >
                <Avatar
                  name={profile?.display_name ?? "?"}
                  url={profile?.avatar_url}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900">
                    {profile?.display_name ?? "Unknown"}
                    {member.user_id === currentUser.id && (
                      <span className="ml-1 text-xs font-normal text-gray-400">
                        (you)
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {ROLE_LABEL[member.role]}
                  </div>
                </div>
                {manage && (
                  <div className="flex shrink-0 items-center gap-1">
                    {member.role === "member" ? (
                      <button
                        onClick={() => setRole(member, "admin")}
                        disabled={busy}
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                      >
                        Promote
                      </button>
                    ) : (
                      <button
                        onClick={() => setRole(member, "member")}
                        disabled={busy}
                        className="rounded-lg px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Demote
                      </button>
                    )}
                    <button
                      onClick={() => removeMember(member)}
                      disabled={busy}
                      className="rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
