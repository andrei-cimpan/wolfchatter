"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

interface DeleteRoomDialogProps {
  open: boolean;
  pending: boolean;
  failed: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Asks before a room and its messages go for good. A native modal dialog: it keeps focus inside,
 * closes on Escape, and a click on the backdrop closes it too. Rendered into the body, not the
 * chat panel, so it is not part of the panel's content.
 */
export function DeleteRoomDialog({ open, pending, failed, onCancel, onConfirm }: DeleteRoomDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onCancel}
      // Kept open while deleting, so a failure has somewhere to show.
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
      // The dialog's own box is filled by its content, so a click on the dialog itself is the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
      className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-md border border-foreground/30 bg-background p-0 text-foreground shadow-lg backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-3 p-4">
        <h2 id={titleId} className="font-medium">
          Delete this room and all its messages?
        </h2>
        <p className="text-sm text-foreground/70">This can&apos;t be undone.</p>
        {failed && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            Couldn&apos;t delete the room. Please try again.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" autoFocus onClick={onCancel} className="h-11 rounded px-3 hover:bg-foreground/10">
            Cancel
          </button>
          <button
            type="button"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) onConfirm();
            }}
            className="h-11 rounded bg-red-700 px-3 font-medium text-white not-aria-disabled:hover:bg-red-800 aria-disabled:opacity-60"
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
