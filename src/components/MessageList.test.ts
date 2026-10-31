import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/types";
import { MessageItems } from "./MessageList";

function message(overrides: Partial<Message>): Message {
  return {
    id: "5d7c1a2b-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
    roomId: "0b9f8c4e-2f7a-4d55-9a53-1f3e2d4c5b6a",
    author: "ana",
    body: "Hello",
    createdAt: "2026-10-31T12:00:00.000Z",
    ...overrides,
  };
}

function render(messages: Message[]) {
  return renderToStaticMarkup(createElement(MessageItems, { messages }));
}

describe("MessageItems", () => {
  it("renders author and body as text, never as HTML", () => {
    const html = render([message({ author: "<i>ana</i>", body: '<img src=x onerror="alert(1)">' })]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<i>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;i&gt;ana&lt;/i&gt;:");
  });

  it("keeps line breaks in the body", () => {
    const html = render([message({ body: "one\ntwo" })]);
    expect(html).toContain("one\ntwo");
    expect(html).toContain("whitespace-pre-wrap");
  });

  it("gives each message a machine-readable timestamp", () => {
    expect(render([message({})])).toContain('<time dateTime="2026-10-31T12:00:00.000Z"');
  });

  it("lists messages in the order given", () => {
    const html = render([message({ id: "a", body: "first" }), message({ id: "b", body: "second" })]);
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
  });
});
