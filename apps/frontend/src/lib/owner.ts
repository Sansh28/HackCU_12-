import { API_BASE_URL } from "@/lib/config";

const AUTH_STORAGE_KEY = "savant_auth_session_v1";
const CLIENT_HINT_STORAGE_KEY = "savant_client_hint_v1";

type AuthSession = {
  accessToken: string;
  ownerId: string;
  expiresAt: number;
};

function getClientHint(): string {
  if (typeof window === "undefined") {
    return "server-render";
  }

  const existing = window.localStorage.getItem(CLIENT_HINT_STORAGE_KEY);
  if (existing) return existing;

  const created =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `web_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
      : `web_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  window.localStorage.setItem(CLIENT_HINT_STORAGE_KEY, created);
  return created;
}

function readStoredSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.accessToken || !parsed.ownerId || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistSession(session: AuthSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

async function createSession(): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/auth/session`, {
    method: "POST",
    headers: {
      "X-Savant-Client": getClientHint(),
    },
  });
  const data = (await response.json()) as {
    access_token?: string;
    owner_id?: string;
    expires_at?: number;
    detail?: string;
  };
  if (!response.ok || !data.access_token || !data.owner_id || !data.expires_at) {
    throw new Error(data.detail || "Failed to create an authenticated Savant session");
  }

  const session = {
    accessToken: data.access_token,
    ownerId: data.owner_id,
    expiresAt: data.expires_at,
  };
  persistSession(session);
  return session;
}

export async function getClientAuthSession(): Promise<AuthSession> {
  const existing = readStoredSession();
  const now = Math.floor(Date.now() / 1000);
  if (existing && existing.expiresAt - 30 > now) {
    return existing;
  }
  return createSession();
}
