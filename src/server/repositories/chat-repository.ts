import type { Bbox, MapItem, Message, Room } from "@/lib/types";

export type ListMessagesOptions = {
  /** Message id: return the page just older than this message. */
  before?: string;
  /** Message id: return messages newer than this message. */
  after?: string;
  limit?: number;
};

// Lets route handlers answer 404 without knowing which database is behind the interface.
export class RoomNotFoundError extends Error {
  constructor(roomId: string) {
    super(`Room ${roomId} does not exist`);
    this.name = "RoomNotFoundError";
  }
}

export interface ChatRepository {
  /** Rejects if the store cannot answer right now. */
  ping(): Promise<void>;
  getRoom(id: string): Promise<Room | null>;
  listMapItems(query: { bbox: Bbox; zoom: number }): Promise<MapItem[]>;
  createRoom(input: { lat: number; lng: number }): Promise<Room>;
  /** Saves both or neither, so a failed post cannot leave an empty room on the map. */
  createRoomWithMessage(
    room: { lat: number; lng: number },
    message: { author: string; body: string },
  ): Promise<{ room: Room; message: Message }>;
  /** Oldest first. Without a cursor, returns the latest page. */
  listMessages(roomId: string, opts?: ListMessagesOptions): Promise<Message[]>;
  /** Throws RoomNotFoundError if the room does not exist. */
  postMessage(roomId: string, input: { author: string; body: string }): Promise<Message>;
}
