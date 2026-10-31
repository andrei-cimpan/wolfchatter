// Shapes shared by the API and the UI. Timestamps are ISO 8601 strings so they survive JSON.

export type Room = {
  id: string;
  title: string;
  lat: number;
  lng: number;
  messageCount: number;
  createdAt: string;
};

export type Message = {
  id: string;
  roomId: string;
  author: string;
  body: string;
  createdAt: string;
};

export type MapItem =
  | { type: "room"; id: string; title: string; lat: number; lng: number; messageCount: number }
  | { type: "cluster"; lat: number; lng: number; count: number };

export type Bbox = { west: number; south: number; east: number; north: number };
