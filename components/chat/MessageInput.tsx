"use client";

import { useState } from "react";

export function MessageInput({
  onSend,
  disabled = false,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  }

  return (
    <div className="flex items-end gap-2 border-t border-gray-200 bg-gray-50 p-3">
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
        placeholder="Type a message"
        className="max-h-32 flex-1 resize-none rounded-3xl border border-gray-300 bg-white px-4 py-2.5 text-[15px] outline-none focus:border-blue-500"
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || !text.trim()}
        aria-label="Send message"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
          <path d="M3.4 20.4 22 12 3.4 3.6 3.39 10.2 15.3 12 3.39 13.8z" />
        </svg>
      </button>
    </div>
  );
}
