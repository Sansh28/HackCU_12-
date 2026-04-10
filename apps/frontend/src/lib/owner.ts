const OWNER_STORAGE_KEY = "savant_owner_token_v1";

function generateOwnerToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `owner_${crypto.randomUUID()}`;
  }
  return `owner_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

export function getClientOwnerToken(): string {
  if (typeof window === "undefined") {
    return "owner_server_render";
  }

  const existing = window.localStorage.getItem(OWNER_STORAGE_KEY);
  if (existing) return existing;

  const created = generateOwnerToken();
  window.localStorage.setItem(OWNER_STORAGE_KEY, created);
  return created;
}
