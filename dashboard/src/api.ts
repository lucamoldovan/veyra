export interface ServerHealth {
  status: "ok";
  service: string;
  version: string;
}

export type ConnectionState = "checking" | "online" | "offline";

export async function getServerHealth(
  signal?: AbortSignal,
): Promise<ServerHealth> {
  const response = await fetch("/api/v1/health", {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}`);
  }

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
