import { formatTime } from "@/lib/utils";
import type { Profile } from "@/lib/types";

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
}: {
  content: string;
  createdAt: string;
  isOwn: boolean;
  showSenderName: boolean;
  sender?: Profile | null;
}) {
  return (
    <div className={`flex px-3 py-0.5 ${isOwn ? "justify-end" : "justify-start"}`}>
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
        <p className="whitespace-pre-wrap break-words text-[15px] leading-snug text-gray-900">
          {content}
        </p>
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-gray-500">
          <span>{formatTime(createdAt)}</span>
          {isOwn && <CheckIcon />}
        </div>
      </div>
    </div>
  );
}
