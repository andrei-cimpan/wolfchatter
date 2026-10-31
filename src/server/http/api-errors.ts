import type { z } from "zod";

export type ApiErrorCode = "validation_error" | "invalid_json" | "room_not_found" | "internal_error";

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

/** Reads a JSON body, or returns the 400 to send when it is not JSON. */
export async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: apiError(400, "invalid_json", "Request body must be valid JSON") };
  }
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
