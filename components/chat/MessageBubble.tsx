import { formatTime } from "@/lib/utils";
import { formatBytes, isImageAttachment } from "@/lib/attachments";
import { MessageActions } from "./MessageActions";
import type { Attachment, Profile, ReplyTo } from "@/lib/types";

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 text-sky-500"
      fill="currentColor"
      aria-label="Delivered"
    >
      <path d="M11.8 4.7 6.9 9.6 4.9 7.6 3.6 8.9 6.9 12.2 13.1 6z" />
    </svg>
  );
}

export function MessageBubble({
  content,
  createdAt,
  isOwn,
  showSenderName,
  sender,
  attachments = [],
  replyTo,
  editedAt,
  deletedAt,
  pinnedAt,
  canAdminDelete = false,
  decryptFailed = false,
  onReply,
  onCopy,
  onPin,
  onEdit,
  onDelete,
}: {
  content: string;
  createdAt: string;
  isOwn: boolean;
  showSenderName: boolean;
  sender?: Profile | null;
  attachments?: Attachment[];
  replyTo?: ReplyTo | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  pinnedAt?: string | null;
  canAdminDelete?: boolean;
  decryptFailed?: boolean;
  onReply?: () => void;
  onCopy?: () => void;
  onPin?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter((a) => !isImageAttachment(a));
  const deleted = Boolean(deletedAt);

  return (
    <div
      className={`group relative flex px-3 py-0.5 ${
        isOwn ? "justify-end" : "justify-start"
      }`}
    >
      {!deleted && onReply && (
        <div className="absolute -top-3 right-2 z-20 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <MessageActions
            pinned={Boolean(pinnedAt)}
            deleted={deleted}
            isOwn={isOwn}
            canDelete={canAdminDelete}
            onReply={onReply}
            onCopy={onCopy ?? (() => {})}
            onPin={onPin ?? (() => {})}
            onEdit={onEdit ?? (() => {})}
            onDelete={onDelete ?? (() => {})}
          />
        </div>
      )}

      <div
        className={`max-w-[78%] rounded-2xl px-3 py-1.5 shadow-sm ${
          deleted
            ? "bg-gray-100 text-gray-400 italic"
            : isOwn
              ? "rounded-br-md bg-[#d9ecfd]"
              : "rounded-bl-md border border-gray-100 bg-white"
        }`}
      >
        {!deleted && showSenderName && sender && (
          <div className="mb-0.5 text-xs font-semibold text-blue-600">
            {sender.display_name}
          </div>
        )}

        {!deleted && replyTo && (
          <div className="mb-1 overflow-hidden rounded-lg border-l-4 border-blue-400 bg-black/5 px-2 py-1">
            <div className="truncate text-xs font-semibold text-blue-600">
              {replyTo.sender_name}
            </div>
            <div className="truncate text-xs text-gray-600">
              {replyTo.content ||
                (replyTo.attachment_name
                  ? `📎 ${replyTo.attachment_name}`
                  : "Message")}
            </div>
          </div>
        )}

        {deleted ? (
          <p className="text-sm">This message was deleted</p>
        ) : decryptFailed ? (
          <p className="text-sm text-gray-500">
            🔒 This message can’t be decrypted on this device
          </p>
        ) : (
          <>
            {attachments.length > 0 && (
              <div className="mb-1 flex flex-col gap-1">
                {images.length > 0 && (
                  <div
                    className={`grid gap-1 ${
                      images.length > 1 ? "grid-cols-2" : "grid-cols-1"
                    }`}
                  >
                    {images.map((att) => (
                      <a
                        key={att.path}
                        href={att.url}
                        target="_blank"
                        rel="noreferrer"
                        title={att.name}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={att.url}
                          alt={att.name}
                          className="max-h-56 w-full rounded-lg object-cover"
                        />
                      </a>
                    ))}
                  </div>
                )}
                {files.map((att) => (
                  <a
                    key={att.path}
                    href={att.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white/70 px-2.5 py-2 transition-colors hover:bg-white"
                  >
                    <FileIcon />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-800">
                        {att.name}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        {formatBytes(att.size)}
                      </div>
                    </div>
                    <DownloadIcon />
                  </a>
                ))}
              </div>
            )}

            {content && (
              <p className="whitespace-pre-wrap break-words text-[15px] leading-snug text-gray-900">
                {content}
              </p>
            )}
          </>
        )}

        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-gray-500">
          <span>{formatTime(createdAt)}</span>
          {!deleted && editedAt && <span>(edited)</span>}
          {!deleted && isOwn && <CheckIcon />}
        </div>
      </div>
    </div>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
  );
}
