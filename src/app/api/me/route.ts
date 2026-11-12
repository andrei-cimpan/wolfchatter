import { withErrorHandling } from "@/server/http/api-errors";
import { getChatRepository } from "@/server/repositories";

/** Who is signed in, as `{ name }`: the name they post under, or null when signed out. */
export const GET = withErrorHandling(async (request: Request) => {
  const name = await getChatRepository(request).currentAuthorName();
  // Per user and changes on sign-in or out, so no cache may keep it.
  return Response.json({ name }, { headers: { "Cache-Control": "no-store" } });
});
