import { connection } from "next/server";
import { withErrorHandling } from "@/server/http/api-errors";
import { getChatRepository } from "@/server/repositories";

const answer = withErrorHandling(async (request: Request) => {
  const name = await getChatRepository(request).currentAuthorName();
  // Per user and changes on sign-in or out, so no cache may keep it.
  return Response.json({ name }, { headers: { "Cache-Control": "no-store" } });
});

/** Who is signed in, as `{ name }`: the name they post under, or null when signed out. */
export async function GET(request: Request): Promise<Response> {
  // It takes no params, so `next build` would otherwise try to prerender it. Outside the error
  // handling, since the prerender's own signals must reach Next rather than be logged as errors.
  await connection();
  return answer(request);
}
