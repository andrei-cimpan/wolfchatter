import { connection } from "next/server";
import { healthResponse } from "@/server/http/health";
import { getChatRepository } from "@/server/repositories";

/** For load balancers and uptime checks: 200 while this instance can reach its database, otherwise 503. */
export async function GET(request: Request): Promise<Response> {
  // Reads nothing from the request, so `next build` would otherwise run it and log a failed check.
  await connection();
  return healthResponse(() => getChatRepository(request).ping());
}
