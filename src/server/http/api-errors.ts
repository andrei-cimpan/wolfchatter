import type { z } from "zod";
import { NotSignedInError } from "@/server/repositories/chat-repository";

export type ApiErrorCode =
  | "validation_error"
  | "invalid_json"
  | "payload_too_large"
  | "unsupported_media_type"
  | "room_not_found"
  | "unauthenticated"
  | "forbidden"
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

// Unexpected failures (database down, bugs) still answer in the error shape, and the details go to
// the server log rather than to the caller.
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      // Thrown only by a write, after the input was validated, so a broken signed-out request still
      // learns what is wrong with it first.
      if (error instanceof NotSignedInError) return apiError(401, "unauthenticated", "Sign in to post");
      console.error("Unhandled API error", error);
      return apiError(500, "internal_error", "Something went wrong");
    }
  };
}
