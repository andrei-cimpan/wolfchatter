import { roomIdSchema } from "@/lib/schemas";
import { roomNotFound, withErrorHandling } from "@/server/http/api-errors";
import { getChatRepository } from "@/server/repositories";

/** One room by id. */
export const GET = withErrorHandling(async (_request: Request, ctx: RouteContext<"/api/rooms/[id]">) => {
  const { id } = await ctx.params;
  // A malformed id and an unknown one both mean "no such room" to the caller.
  if (!roomIdSchema.safeParse(id).success) return roomNotFound();

  const room = await getChatRepository().getRoom(id);
  return room ? Response.json(room) : roomNotFound();
});
