import type { MessageSource } from "@/server/realtime/message-source";
import type { ChatRepository } from "./chat-repository";
import { databaseUrl, getPool } from "./db";
import { PostgresChatRepository } from "./postgres-chat-repository";
import { PostgresMessageSource } from "./postgres-message-source";

export { RoomNotFoundError, type ChatRepository, type ListMessagesOptions } from "./chat-repository";

// The one place that picks the implementation; v2 swaps in Supabase here.
export function getChatRepository(): ChatRepository {
  return new PostgresChatRepository(getPool());
}

// Each call opens its own LISTEN connection once started; getRealtimeHub keeps the one shared source.
export function createMessageSource(): MessageSource {
  return new PostgresMessageSource(databaseUrl());
}
