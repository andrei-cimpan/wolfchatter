import { listMessagesQuerySchema, postMessageSchema, roomIdSchema } from "@/lib/schemas";
import { readJson, roomNotFound, validationError, withErrorHandling } from "@/server/http/api-errors";
import { queryInput } from "@/server/http/query-input";
import { enforceRateLimit, messagePostLimiter } from "@/server/http/rate-limit";
import { getChatRepository, RoomNotFoundError } from "@/server/repositories";

type Context = RouteContext<"/api/rooms/[id]/messages">;

/** A page of messages, oldest first: `?before=<id>` or `?after=<id>`, and `limit`. */
export const GET = withErrorHandling(async (request: Request, ctx: Context) => {
  const { id } = await ctx.params;
  // A malformed id and an unknown one both mean "no such room" to the caller.
  if (!roomIdSchema.safeParse(id).success) return roomNotFound();

  const params = new URL(request.url).searchParams;
  const query = listMessagesQuerySchema.safeParse(queryInput(params, ["before", "after", "limit"]));
  if (!query.success) return validationError(query.error);

  const repository = getChatRepository();
  // listMessages answers [] for an unknown room, which would read as "a room with no messages".
  if (!(await repository.getRoom(id))) return roomNotFound();
  return Response.json(await repository.listMessages(id, query.data));
});

/** Posts `{ author, body }` to the room. */
export const POST = withErrorHandling(async (request: Request, ctx: Context) => {
  // Counted before anything else, so invalid requests and unknown rooms spend the budget too.
  const limited = enforceRateLimit(messagePostLimiter, request);
  if (limited) return limited;

  const { id } = await ctx.params;
  if (!roomIdSchema.safeParse(id).success) return roomNotFound();

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const input = postMessageSchema.safeParse(body.value);
  if (!input.success) return validationError(input.error);

  try {
    // No Location header: there is no endpoint that serves a single message.
    return Response.json(await getChatRepository().postMessage(id, input.data), { status: 201 });
  } catch (error) {
    if (error instanceof RoomNotFoundError) return roomNotFound();
    throw error;
  }
});
