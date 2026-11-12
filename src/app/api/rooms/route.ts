import { createRoomSchema, mapItemsQuerySchema } from "@/lib/schemas";
import type { Room, RoomWithFirstMessage } from "@/lib/types";
import { validationError, withErrorHandling } from "@/server/http/api-errors";
import { queryInput } from "@/server/http/query-input";
import { enforceRateLimit, roomCreationLimiter } from "@/server/http/rate-limit";
import { readJson } from "@/server/http/read-json";
import { getChatRepository } from "@/server/repositories";

function roomCreated(room: Room | RoomWithFirstMessage): Response {
  return Response.json(room, { status: 201, headers: { Location: `/api/rooms/${room.id}` } });
}

/** Rooms and clusters in the viewport: `?bbox=west,south,east,north&zoom=z`. */
export const GET = withErrorHandling(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const query = mapItemsQuerySchema.safeParse(queryInput(params, ["bbox", "zoom"]));
  if (!query.success) return validationError(query.error);

  return Response.json(await getChatRepository(request).listMapItems(query.data));
});

/** Creates a room at `{ lat, lng }`, together with `firstMessage: { author, body }` if given. */
export const POST = withErrorHandling(async (request: Request) => {
  // Counted before validation, so a flood of invalid requests spends the budget too.
  const limited = enforceRateLimit(roomCreationLimiter, request);
  if (limited) return limited;

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const input = createRoomSchema.safeParse(body.value);
  if (!input.success) return validationError(input.error);

  const { firstMessage, ...position } = input.data;
  const repository = getChatRepository(request);
  if (!firstMessage) return roomCreated(await repository.createRoom(position));
  const { room, message } = await repository.createRoomWithMessage(position, firstMessage);
  return roomCreated({ ...room, firstMessage: message });
});
