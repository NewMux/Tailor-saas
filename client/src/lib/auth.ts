import { clearOrgSuspended } from "@/lib/orgSuspended";

type AuthUser = { id: number; name: string | null; email: string | null; role: "user" | "admin" };
type AuthResponse = { user: AuthUser; token: string };

type AuthErrorPayload = { error?: { message?: string; code?: string } };

const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "erp_local_session";
const IMPERSONATION_TOKEN_KEY = "erp_impersonation_session";

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

function readStorageItem(key: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageItem(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // The HttpOnly cookie remains available for same-origin deployments.
  }
}

/** The impersonation token is per tab (sessionStorage); the operator's own token stays where it was. */
function readSessionItem(key: string) {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionItem(key: string, value: string | null) {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Without sessionStorage, impersonation simply is not available.
  }
}

function readToken() {
  return readSessionItem(IMPERSONATION_TOKEN_KEY) ?? readStorageItem(TOKEN_KEY);
}

function writeToken(token: string | null) {
  writeStorageItem(TOKEN_KEY, token);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = readToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(apiUrl(path), { ...init, headers, credentials: "include" });
  const payload = (await response.json().catch(() => ({}))) as T & AuthErrorPayload;
  if (!response.ok) {
    throw new Error(payload.error?.message || "Authentication request failed.");
  }
  return payload as T;
}

function remember(response: AuthResponse) {
  writeToken(response.token);
  clearOrgSuspended();
  window.dispatchEvent(new Event("auth-changed"));
  return response;
}

export const authApi = {
  async session() {
    const response = await request<{ authenticated: boolean; user: AuthUser | null }>("/api/auth/session", { method: "GET" });
    return response.authenticated;
  },
  /** Accepts a staff invite. New shops are created by platform staff, not here. */
  async register(input: { name: string; email: string; password: string; mode: "join_invite"; inviteToken: string }) {
    return remember(await request<AuthResponse>("/api/auth/register", { method: "POST", body: JSON.stringify(input) }));
  },
  async login(email: string, password: string) {
    return remember(await request<AuthResponse>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }));
  },
  async forgot(email: string) {
    return request<{ message: string; resetUrl?: string }>("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) });
  },
  async inviteDetails(token: string) {
    return request<{ email: string; name: string; shopName: string | null }>(`/api/auth/invite?token=${encodeURIComponent(token)}`, { method: "GET" });
  },
  async reset(token: string, password: string) {
    return remember(await request<AuthResponse>("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) }));
  },
  async logout() {
    // Signing out ends every session this browser holds, including the
    // operator's own one behind an impersonation tab.
    const tokens = [readSessionItem(IMPERSONATION_TOKEN_KEY), readStorageItem(TOKEN_KEY)].filter((token): token is string => Boolean(token));
    try {
      for (const token of tokens.length ? tokens : [undefined]) {
        await fetch(apiUrl("/api/auth/logout"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          credentials: "include",
        }).catch(() => undefined);
      }
    } finally {
      writeSessionItem(IMPERSONATION_TOKEN_KEY, null);
      writeToken(null);
      clearOrgSuspended();
      window.dispatchEvent(new Event("auth-changed"));
    }
  },
  getToken() {
    return readToken();
  },
  clearToken() {
    writeToken(null);
  },
  /** Confirms the password for the current session; high-risk operator actions require it to be recent. */
  async reauth(password: string) {
    return request<{ ok: boolean; reauthValidUntil: string }>("/api/auth/reauth", { method: "POST", body: JSON.stringify({ password }) });
  },
  /** Uses an impersonation token in this tab only. The operator's own session is left untouched. */
  beginImpersonation(token: string) {
    writeSessionItem(IMPERSONATION_TOKEN_KEY, token);
    clearOrgSuspended();
    window.dispatchEvent(new Event("auth-changed"));
  },
  /** Drops the impersonation token; the operator's own session is still in place. Callers end the session server-side first. */
  endImpersonation() {
    writeSessionItem(IMPERSONATION_TOKEN_KEY, null);
    clearOrgSuspended();
    window.dispatchEvent(new Event("auth-changed"));
  },
};
