import { roomIdSchema } from "@/lib/schemas";
import { roomNotFound, withErrorHandling } from "@/server/http/api-errors";
import { openRoomEventStream } from "@/server/http/room-event-stream";
import { SSE_HEADERS } from "@/server/http/sse";
import { getRealtimeHub } from "@/server/realtime";
import { getChatRepository } from "@/server/repositories";

type Context = RouteContext<"/api/rooms/[id]/stream">;

/** Server-Sent Events: `ready` once subscribed, then a `message` event per new message in the room. */
export const GET = withErrorHandling(async (request: Request, ctx: Context) => {
  const { id } = await ctx.params;
  if (!roomIdSchema.safeParse(id).success) return roomNotFound();
  // A plain 404 rather than a stream: EventSource gives up on it instead of reconnecting forever.
  if (!(await getChatRepository().getRoom(id))) return roomNotFound();

  return new Response(openRoomEventStream(getRealtimeHub(), id, request.signal), { headers: SSE_HEADERS });
});
