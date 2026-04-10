import { API_BASE_URL } from "@/lib/config";
import { getClientOwnerToken } from "@/lib/owner";

export function withOwnerHeaders(headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers);
  nextHeaders.set("X-Savant-Owner", getClientOwnerToken());
  return nextHeaders;
}

export function savantFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: withOwnerHeaders(init.headers),
  });
}
