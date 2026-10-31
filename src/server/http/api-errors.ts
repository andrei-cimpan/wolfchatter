import type { z } from "zod";

export type ApiErrorCode =
  | "validation_error"
  | "invalid_json"
  | "payload_too_large"
  | "room_not_found"
  | "internal_error";

/** Every API error uses this one shape, so the client has a single parser. */
export function apiError(status: number, code: ApiErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

// One readable line is enough for a form or a log; the full issue list would leak schema internals.
export function validationError(error: z.ZodError): Response {
  const issue = error.issues[0];
  if (!issue) return apiError(400, "validation_error", "Invalid input");
  const path = issue.path.map(String).join(".");
  return apiError(400, "validation_error", path ? `${path}: ${issue.message}` : issue.message);
}

export function roomNotFound(): Response {
  return apiError(404, "room_not_found", "Room not found");
}

// The largest valid input, a 1000-character message, is under 8 KB even with every character
// escaped as \uXXXX, so 16 KB leaves headroom while stopping one request from making the server
// buffer and parse megabytes.
export const JSON_BODY_MAX_BYTES = 16 * 1024;

type ReadJsonResult = { ok: true; value: unknown } | { ok: false; response: Response };

/** Reads a JSON body of at most JSON_BODY_MAX_BYTES, or returns the error response to send. */
export async function readJson(request: Request): Promise<ReadJsonResult> {
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

// Unexpected failures (database down, bugs) still answer in the error shape, and the details go to
// the server log rather than to the caller.
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error("Unhandled API error", error);
      return apiError(500, "internal_error", "Something went wrong");
    }
  };
}
