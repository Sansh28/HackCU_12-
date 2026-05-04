const rawApiBaseUrl = import.meta.env.VITE_SAVANT_API_BASE_URL || "http://127.0.0.1:8000";

export const API_BASE_URL = rawApiBaseUrl.replace(/\/+$/, "");
export const SAVANT_AUTH_ENDPOINT = `${API_BASE_URL}/auth/session`;
export const SAVANT_AUTH_STORAGE_KEY = "savant_auth_session_v1";
