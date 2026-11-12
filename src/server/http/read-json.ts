import { apiError } from "./api-errors";

// The largest valid input, a 1000-character message, is about 12 KB even with every character an
// emoji escaped as two \uXXXX, so 16 KB leaves headroom while stopping one request from making the server
// buffer and parse megabytes.
export const JSON_BODY_MAX_BYTES = 16 * 1024;

type ReadJsonResult = { ok: true; value: unknown } | { ok: false; response: Response };

/**
 * Reads a JSON body of at most JSON_BODY_MAX_BYTES, or returns the error response to send.
 * The body must be labelled `application/json`: a cross-site `<form enctype="text/plain">` can
 * send a JSON-looking body with no CORS preflight, from each visitor's own IP, and the label is
 * what a form cannot fake.
 */
export async function readJson(request: Request): Promise<ReadJsonResult> {
  if (!isJsonMediaType(request.headers.get("content-type"))) {
    return {
      ok: false,
      response: apiError(415, "unsupported_media_type", "Content-Type must be application/json"),
    };
  }
  const text = await readTextWithin(request, JSON_BODY_MAX_BYTES);
  if (text === null) {
    return {
      ok: false,
      response: apiError(413, "payload_too_large", `Request body must be at most ${JSON_BODY_MAX_BYTES} bytes`),
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: apiError(400, "invalid_json", "Request body must be valid JSON") };
  }
}

// Parameters such as `; charset=utf-8` are allowed. `+json` types are not: our client never sends
// them, and the stricter the match, the less a cross-site request can slip through.
function isJsonMediaType(header: string | null): boolean {
  return header?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

// request.text() would buffer the whole body first. Content-Length is checked up front, but it can
// be absent (chunked uploads) or wrong, so the stream is counted too and abandoned past the limit.
async function readTextWithin(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  // TextDecoder drops a leading BOM, matching request.json().
  return new TextDecoder().decode(concat(chunks, size));
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
