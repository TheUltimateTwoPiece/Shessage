import { formatTime } from "@/lib/utils";
import { formatBytes, isImageAttachment } from "@/lib/attachments";
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

function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 17l-5-5 5-5M4 12h10a6 6 0 0 1 6 6v1" />
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
  onReply,
}: {
  content: string;
  createdAt: string;
  isOwn: boolean;
  showSenderName: boolean;
  sender?: Profile | null;
  attachments?: Attachment[];
  replyTo?: ReplyTo | null;
  onReply?: () => void;
}) {
  const images = attachments.filter(isImageAttachment);
  const files = attachments.filter((a) => !isImageAttachment(a));

  return (
    <div className={`group relative flex px-3 py-0.5 ${isOwn ? "justify-end" : "justify-start"}`}>
      {onReply && (
        <button
          onClick={onReply}
          aria-label="Reply"
          title="Reply"
          className="absolute -top-2 right-2 z-10 rounded-full bg-white p-1.5 text-gray-500 shadow ring-1 ring-gray-200 transition-opacity hover:text-blue-600 md:opacity-0 md:group-hover:opacity-100"
        >
          <ReplyIcon />
        </button>
      )}

      <div
        className={`max-w-[78%] rounded-2xl px-3 py-1.5 shadow-sm ${
          isOwn
            ? "rounded-br-md bg-[#d9ecfd]"
            : "rounded-bl-md border border-gray-100 bg-white"
        }`}
      >
        {showSenderName && sender && (
          <div className="mb-0.5 text-xs font-semibold text-blue-600">
            {sender.display_name}
          </div>
        )}

        {replyTo && (
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

        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-gray-500">
          <span>{formatTime(createdAt)}</span>
          {isOwn && <CheckIcon />}
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
