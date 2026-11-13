"use client";

import { useState } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDeleteRoom } from "@/hooks/useDeleteRoom";
import { useRoom } from "@/hooks/useRoom";
import { DeleteRoomDialog } from "./DeleteRoomDialog";

/** The room creator's way to delete it, after a confirmation. Nothing for anyone else. */
export function DeleteRoomButton({ roomId, className = "" }: { roomId: string; className?: string }) {
  const { data: room } = useRoom(roomId);
  const user = useCurrentUser();
  const deletion = useDeleteRoom(roomId);
  const [confirming, setConfirming] = useState(false);
  if (!room?.canDelete || user.status !== "signedIn") return null;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          deletion.reset();
          setConfirming(true);
        }}
        className={`h-11 shrink-0 rounded px-2 text-sm text-red-700 underline hover:bg-foreground/10 dark:text-red-400 ${className}`}
      >
        Delete room
      </button>
      <DeleteRoomDialog
        open={confirming && !deletion.isSuccess}
        pending={deletion.isPending}
        failed={deletion.isError}
        onCancel={() => setConfirming(false)}
        onConfirm={() => deletion.mutate()}
      />
    </>
  );
}
