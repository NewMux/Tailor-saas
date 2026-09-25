import { clearOrgSuspended } from "@/lib/orgSuspended";

type AuthUser = { id: number; name: string | null; email: string | null; role: "user" | "admin" };
type AuthResponse = { user: AuthUser; token: string };

type AuthErrorPayload = { error?: { message?: string; code?: string } };

const API_BASE_URL = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "erp_local_session";
const IMPERSONATOR_TOKEN_KEY = "erp_impersonator_session";

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

function readToken() {
  return readStorageItem(TOKEN_KEY);
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
  async register(
    input: { name: string; email: string; password: string } & (
      | { mode: "create_org"; orgName: string }
      | { mode: "join_invite"; inviteToken: string }
    )
  ) {
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
    try {
      await request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
    } finally {
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
  /** Swaps the active session to an impersonation token, stashing the platform staff member's own token to restore later. */
  beginImpersonation(token: string) {
    const own = readToken();
    if (own) writeStorageItem(IMPERSONATOR_TOKEN_KEY, own);
    writeToken(token);
    clearOrgSuspended();
    window.dispatchEvent(new Event("auth-changed"));
  },
  /** Restores the platform staff member's own session after impersonation ends. Purely local - callers must end the session server-side first. */
  endImpersonation() {
    const own = readStorageItem(IMPERSONATOR_TOKEN_KEY);
    writeToken(own);
    writeStorageItem(IMPERSONATOR_TOKEN_KEY, null);
    clearOrgSuspended();
    window.dispatchEvent(new Event("auth-changed"));
  },
};
