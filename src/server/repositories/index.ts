import type { ChatRepository } from "./chat-repository";
import { getPool } from "./db";
import { PostgresChatRepository } from "./postgres-chat-repository";

export { RoomNotFoundError, type ChatRepository, type ListMessagesOptions } from "./chat-repository";

// The one place that picks the implementation; v2 swaps in Supabase here.
export function getChatRepository(): ChatRepository {
  return new PostgresChatRepository(getPool());
}
