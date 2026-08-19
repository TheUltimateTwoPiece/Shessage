"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { uploadAvatar } from "@/lib/attachments";
import { Avatar } from "@/components/Avatar";
import type { Profile } from "@/lib/types";

export function SettingsForm({ profile }: { profile: Profile | null }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function pickFile(list: FileList | null) {
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
    setFile(f);
    setPreview(URL.createObjectURL(f));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function save() {
    const name = displayName.trim();
    if (!name) {
      setError("Display name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      let avatarUrl = profile?.avatar_url ?? null;
      if (file) {
        avatarUrl = await uploadAvatar(file, user.id);
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: name,
          bio: bio.trim() || null,
          avatar_url: avatarUrl,
        })
        .eq("id", user.id);
      if (error) throw error;
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save your profile."
      );
    } finally {
      setSaving(false);
    }
  }

  const shownPreview = preview ?? profile?.avatar_url ?? null;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#efeae2] p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
          <button
            onClick={() => router.push("/chat")}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            ← Back to chat
          </button>
        </div>

        <div className="mb-5 flex flex-col items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            aria-label="Change profile picture"
            className="group relative"
          >
            <Avatar
              name={displayName || "You"}
              url={shownPreview}
              size="lg"
            />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
              Change
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files)}
          />
          <p className="text-xs text-gray-500">
            Tap the avatar to upload a profile picture
          </p>
        </div>

        <label className="mb-1 block text-sm font-medium text-gray-700">
          Display name
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={40}
          placeholder="Your name"
          className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
        />

        <label className="mb-1 block text-sm font-medium text-gray-700">
          Bio
        </label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={160}
          rows={3}
          placeholder="Tell people about yourself…"
          className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
        />
        <p className="mt-1 text-right text-[11px] text-gray-400">
          {bio.length}/160
        </p>

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {saved && (
          <div className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
            Profile saved!
          </div>
        )}

        <button
          onClick={save}
          disabled={saving}
          className="mt-4 w-full rounded-lg bg-blue-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
