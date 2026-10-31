import { describe, expect, it } from "vitest";
import { MAP_ITEMS_KEY, mapItemsQueryKey } from "./useMapItems";

describe("mapItemsQueryKey", () => {
  const query = { bbox: { west: 0, south: 33.75, east: 45, north: 56.25 }, zoom: 5 };

  it("starts with the shared prefix, so creating a room can invalidate every viewport", () => {
    expect(mapItemsQueryKey(query).slice(0, MAP_ITEMS_KEY.length)).toEqual([...MAP_ITEMS_KEY]);
  });

  it("differs by bounds and by zoom", () => {
    const key = mapItemsQueryKey(query);
    expect(mapItemsQueryKey({ ...query, zoom: 6 })).not.toEqual(key);
    expect(mapItemsQueryKey({ ...query, bbox: { ...query.bbox, west: 11.25 } })).not.toEqual(key);
    expect(mapItemsQueryKey({ ...query, bbox: { ...query.bbox } })).toEqual(key);
  });
});
