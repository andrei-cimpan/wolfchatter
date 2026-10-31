import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoomPanelFallback } from "./RoomPanel";

// The fallback is what the prerendered page shows before the browser knows `?room`.
describe("RoomPanelFallback", () => {
  const html = renderToStaticMarkup(createElement(RoomPanelFallback));

  it("does not claim that no room is selected, since a ?room link may be loading", () => {
    expect(html).not.toContain("Click on the map to start a chat");
  });

  it("marks the panel as busy", () => {
    expect(html).toContain('aria-busy="true"');
  });
});
