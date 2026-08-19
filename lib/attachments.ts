import { createClient } from "@/lib/supabase/client";
import type { Attachment } from "@/lib/types";

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_ATTACHMENTS_PER_MESSAGE = 6;

/**
 * Uploads a file to the `message-attachments` bucket under
 * `{conversation_id}/{user_id}/{uuid}-{name}` and returns its metadata.
 * Storage RLS only allows participants of that conversation to upload.
 */
export async function uploadAttachment(
  file: File,
  conversationId: string,
  userId: string
): Promise<Attachment> {
  const supabase = createClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const path = `${conversationId}/${userId}/${crypto.randomUUID()}-${safeName}`;

  const { error } = await supabase.storage
    .from("message-attachments")
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = supabase.storage
    .from("message-attachments")
    .getPublicUrl(path);

  return {
    path,
    url: data.publicUrl,
    name: file.name,
    size: file.size,
    mime: file.type,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageAttachment(att: Attachment): boolean {
  return att.mime.startsWith("image/");
}
