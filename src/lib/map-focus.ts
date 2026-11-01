// RoomPanel's card from `md` up: 380 px wide plus its 16 px margin, floating over the map's right
// edge. Below `md` the sheet shrinks the map instead of covering it, so the centre is always clear.
const CARD_COVER_PX = 396;

/** Leaflet's world width at zoom 0. */
const WORLD_PX = 256;

/** Keeps the pin just on the near side of the point where it would change copies. */
const WORLD_MARGIN_PX = 1;

export const WIDE_SCREEN_QUERY = "(min-width: 768px)";

/**
 * How far east of a room to centre the map, so its pin lands in the middle of what the card leaves
 * clear. Pins are drawn on the copy of the world nearest the centre, so past half a world the pin
 * would move to the next copy once the map stops, which at zoom 0 is back under the card.
 */
export function focusShiftPx(zoom: number, isWideScreen: boolean): number {
  if (!isWideScreen) return 0;
  return Math.min(CARD_COVER_PX / 2, (WORLD_PX * 2 ** zoom) / 2 - WORLD_MARGIN_PX);
}
