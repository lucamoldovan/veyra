export interface ServerHealth {
  status: "ok";
  service: string;
  version: string;
}

export interface Operator {
  id: string;
  username: string;
}

export interface AuthSession {
  authenticated: boolean;
  operator: Operator | null;
}

export interface SetupStatus {
  setupRequired: boolean;
}

export type ConnectionState = "checking" | "online" | "offline";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function getServerHealth(signal?: AbortSignal): Promise<ServerHealth> {
  const response = await fetch("/api/v1/health", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
  const payload: unknown = await response.json();

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("status" in payload) ||
    payload.status !== "ok" ||
    !("service" in payload) ||
    typeof payload.service !== "string" ||
    !("version" in payload) ||
    typeof payload.version !== "string"
  ) {
    throw new Error("Server returned an invalid health response");
  }

  return payload as ServerHealth;
}

export function getSetupStatus(): Promise<SetupStatus> {
  return request<SetupStatus>("/api/v1/setup/status");
}

export function getAuthSession(): Promise<AuthSession> {
  return request<AuthSession>("/api/v1/auth/session");
}

export function createInitialOperator(input: {
  setupKey: string;
  username: string;
  password: string;
}): Promise<AuthSession> {
  return request<AuthSession>("/api/v1/setup", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(input: { username: string; password: string }): Promise<AuthSession> {
  return request<AuthSession>("/api/v1/auth/session", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logout(): Promise<{ authenticated: false }> {
  return request<{ authenticated: false }>("/api/v1/auth/session", {
    method: "DELETE",
  });
}
