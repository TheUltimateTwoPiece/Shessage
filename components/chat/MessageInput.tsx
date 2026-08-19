"use client";

import { useRef, useState } from "react";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  formatBytes,
  uploadAttachment,
} from "@/lib/attachments";
import type { Attachment, ReplyTo } from "@/lib/types";

export function MessageInput({
  conversationId,
  currentUserId,
  replyTo,
  onClearReply,
  onSend,
  disabled = false,
}: {
  conversationId: string;
  currentUserId: string;
  replyTo?: ReplyTo | null;
  onClearReply?: () => void;
  onSend: (text: string, attachments: Attachment[], replyTo: ReplyTo | null) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function pickFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const next = Array.from(list);
    const over = next.find((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (over) {
      setError(`"${over.name}" is over the 15 MB limit.`);
      return;
    }
    setFiles((prev) => [...prev, ...next].slice(0, MAX_ATTACHMENTS_PER_MESSAGE));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    const trimmed = text.trim();
    if (uploading) return;
    if (!trimmed && files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const attachments = files.length
        ? await Promise.all(
            files.map((f) => uploadAttachment(f, conversationId, currentUserId))
          )
        : [];
      onSend(trimmed, attachments, replyTo ?? null);
      setText("");
      setFiles([]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not upload the attachments."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border-t border-gray-200 bg-gray-50 px-3 pt-2">
      {replyTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-4 border-blue-400 bg-blue-50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-blue-700">
              Replying to {replyTo.sender_name}
            </div>
            <div className="truncate text-xs text-gray-600">
              {replyTo.content ||
                (replyTo.attachment_name
                  ? `📎 ${replyTo.attachment_name}`
                  : "Message")}
            </div>
          </div>
          <button
            onClick={onClearReply}
            aria-label="Cancel reply"
            className="rounded-full p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {files.map((file, i) => (
            <div
              key={`${file.name}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 shadow-sm"
            >
              {file.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="h-10 w-10 rounded object-cover"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded bg-gray-100 text-gray-500">
                  <FileIcon />
                </div>
              )}
              <div className="max-w-[140px]">
                <div className="truncate text-xs font-medium text-gray-800">
                  {file.name}
                </div>
                <div className="text-[11px] text-gray-500">
                  {formatBytes(file.size)}
                </div>
              </div>
              <button
                onClick={() => removeFile(i)}
                aria-label={`Remove ${file.name}`}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-end gap-2 pb-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => pickFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          aria-label="Attach a file"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.4 11.05 12.25 20.2a5 5 0 0 1-7.07-7.07l9.19-9.19a3.3 3.3 0 0 1 4.67 4.67l-9.2 9.19a1.7 1.7 0 0 1-2.4-2.4l8.63-8.63" />
          </svg>
        </button>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={uploading ? "Uploading…" : "Type a message"}
          className="max-h-32 flex-1 resize-none rounded-3xl border border-gray-300 bg-white px-4 py-2.5 text-[15px] outline-none focus:border-blue-500"
        />

        <button
          type="button"
          onClick={submit}
          disabled={disabled || uploading || (!text.trim() && files.length === 0)}
          aria-label="Send message"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
        >
          {uploading ? (
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M3.4 20.4 22 12 3.4 3.6 3.39 10.2 15.3 12 3.39 13.8z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
