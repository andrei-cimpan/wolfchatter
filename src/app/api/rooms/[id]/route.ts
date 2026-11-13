import { roomIdSchema } from "@/lib/schemas";
import { apiError, roomNotFound, withErrorHandling } from "@/server/http/api-errors";
import { getChatRepository, NotRoomCreatorError, RoomNotFoundError } from "@/server/repositories";

type Context = RouteContext<"/api/rooms/[id]">;

/** One room by id, with whether the caller may delete it. */
export const GET = withErrorHandling(async (request: Request, ctx: Context) => {
  const { id } = await ctx.params;
  // A malformed id and an unknown one both mean "no such room" to the caller.
  if (!roomIdSchema.safeParse(id).success) return roomNotFound();

  const room = await getChatRepository(request).getRoom(id);
  return room ? Response.json(room) : roomNotFound();
});

/** Deletes the room and all its messages; only its creator may. */
export const DELETE = withErrorHandling(async (request: Request, ctx: Context) => {
  const { id } = await ctx.params;
  if (!roomIdSchema.safeParse(id).success) return roomNotFound();

  try {
    await getChatRepository(request).deleteRoom(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof RoomNotFoundError) return roomNotFound();
    if (error instanceof NotRoomCreatorError) return apiError(403, "forbidden", "Only the room's creator can delete it");
    throw error;
  }
});
