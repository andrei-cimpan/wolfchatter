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

// Only a room's creator may delete it; routes answer 403 without knowing who that is.
export class NotRoomCreatorError extends Error {
  constructor(roomId: string) {
    super(`Only the creator of room ${roomId} may delete it`);
    this.name = "NotRoomCreatorError";
  }
}

// Writing needs a signed-in user; routes answer 401 without knowing how sessions are checked.
export class NotSignedInError extends Error {
  constructor() {
    super("Sign in to post");
    this.name = "NotSignedInError";
  }
}

export interface ChatRepository {
  /** Rejects if the store cannot answer right now. */
  ping(): Promise<void>;
  getRoom(id: string): Promise<Room | null>;
  listMapItems(query: { bbox: Bbox; zoom: number }): Promise<MapItem[]>;
  /** Throws NotSignedInError when signed out. */
  createRoom(input: { lat: number; lng: number }): Promise<Room>;
  /**
   * Saves both or neither, so a failed post cannot leave an empty room on the map. The author is
   * the signed-in user's name. Throws NotSignedInError when signed out.
   */
  createRoomWithMessage(room: { lat: number; lng: number }, message: { body: string }): Promise<{ room: Room; message: Message }>;
  /** Oldest first. Without a cursor, returns the latest page. */
  listMessages(roomId: string, opts?: ListMessagesOptions): Promise<Message[]>;
  /**
   * Posts as the signed-in user, whose name becomes the author. Throws RoomNotFoundError if the
   * room does not exist, and NotSignedInError when signed out.
   */
  postMessage(roomId: string, input: { body: string }): Promise<Message>;
  /**
   * Deletes the room and all its messages. Throws RoomNotFoundError if it does not exist,
   * NotRoomCreatorError if the signed-in user did not create it, and NotSignedInError when signed out.
   */
  deleteRoom(roomId: string): Promise<void>;
  /** The name the signed-in user posts under, or null when signed out. */
  currentAuthorName(): Promise<string | null>;
}
