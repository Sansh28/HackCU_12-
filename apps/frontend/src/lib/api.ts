import { API_BASE_URL } from "@/lib/config";
import { getClientAuthSession } from "@/lib/owner";

export async function withOwnerHeaders(headers?: HeadersInit): Promise<Headers> {
  const nextHeaders = new Headers(headers);
  const session = await getClientAuthSession();
  nextHeaders.set("Authorization", `Bearer ${session.accessToken}`);
  return nextHeaders;
}

export async function savantFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: await withOwnerHeaders(init.headers),
  });
}
