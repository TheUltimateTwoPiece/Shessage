"use client";

import { useEffect, useRef, useState } from "react";

export function MessageActions({
  pinned,
  deleted,
  isOwn,
  onReply,
  onCopy,
  onPin,
  onEdit,
  onDelete,
}: {
  pinned: boolean;
  deleted: boolean;
  isOwn: boolean;
  onReply: () => void;
  onCopy: () => void;
  onPin: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const close = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Message actions"
        title="Message actions"
        className="rounded-full bg-white p-1.5 text-gray-500 shadow ring-1 ring-gray-200 transition-colors hover:text-blue-600"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <circle cx="12" cy="5" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-40 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
          <MenuItem onClick={close(onReply)}>Reply</MenuItem>
          <MenuItem onClick={close(onCopy)}>Copy</MenuItem>
          <MenuItem onClick={close(onPin)}>{pinned ? "Unpin" : "Pin"}</MenuItem>
          {isOwn && !deleted && <MenuItem onClick={close(onEdit)}>Edit</MenuItem>}
          {isOwn && !deleted && (
            <MenuItem danger onClick={close(onDelete)}>
              Delete
            </MenuItem>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
        danger
          ? "text-red-600 hover:bg-red-50"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}
