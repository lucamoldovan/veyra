import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDatabase, type VeyraDatabase } from "./database.js";
import { createSession, hashPassword, SESSION_COOKIE, SESSION_TTL, hashSessionToken, verifyPassword } from "./security.js";

interface BuildAppOptions {
  databasePath?: string;
  setupKeyPath?: string;
  setupKey?: string;
  pairingSecretPath?: string;
  pairingSecret?: string;
  https?: { key: Buffer; cert: Buffer; minVersion: "TLSv1.2" };
  secureCookies?: boolean;
}

interface SetupBody {
  setupKey?: unknown;
  username?: unknown;
  password?: unknown;
}

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

function readSetupKey(database: VeyraDatabase, options: BuildAppOptions): { key: string | null; path: string | null; generated: boolean } {
  const operatorCount = database.prepare("SELECT COUNT(*) AS count FROM operators").get() as { count: number };
  const setupKeyPath = resolve(options.setupKeyPath ?? process.env.VEYRA_SETUP_KEY_PATH ?? "data/setup-key");

  if (operatorCount.count > 0) {
    if (!options.setupKey) rmSync(setupKeyPath, { force: true });
    return { key: null, path: null, generated: false };
  }

  if (options.setupKey) return { key: options.setupKey, path: null, generated: false };

  mkdirSync(dirname(setupKeyPath), { recursive: true });

  if (existsSync(setupKeyPath)) {
    const fileInfo = lstatSync(setupKeyPath);
    if (!fileInfo.isFile()) {
      throw new Error("Veyra setup key path must be a regular file, not a symlink or special file");
    }
    chmodSync(setupKeyPath, 0o600);
    const existingKey = readFileSync(setupKeyPath, "utf8").trim();
    if (existingKey.length < 32) {
      throw new Error("Veyra setup key file is empty or invalid; remove it to generate a new key");
    }
    return { key: existingKey, path: setupKeyPath, generated: false };
  }

  const key = randomBytes(24).toString("base64url");
  writeFileSync(setupKeyPath, key + "\n", { mode: 0o600, flag: "wx" });
  return { key, path: setupKeyPath, generated: true };
}

function readPairingSecret(options: BuildAppOptions): Buffer {
  if (options.pairingSecret) {
    const secret = Buffer.from(options.pairingSecret, "utf8");
    if (secret.length < 32) throw new Error("Veyra pairing secret must be at least 32 bytes");
    return secret;
  }

  const secretPath = resolve(options.pairingSecretPath ?? process.env.VEYRA_PAIRING_SECRET_PATH ?? "data/pairing-secret");
  mkdirSync(dirname(secretPath), { recursive: true });

  if (existsSync(secretPath)) {
    const fileInfo = lstatSync(secretPath);
    if (!fileInfo.isFile()) throw new Error("Veyra pairing secret path must be a regular file");
    chmodSync(secretPath, 0o600);
    const value = readFileSync(secretPath, "utf8").trim();
    if (!/^[a-f0-9]{64}$/i.test(value)) {
      throw new Error("Veyra pairing secret file is invalid; restore it from backup or remove it to rotate pairing verification");
    }
    return Buffer.from(value, "hex");
  }

  const secret = randomBytes(32);
  writeFileSync(secretPath, secret.toString("hex") + "\n", { mode: 0o600, flag: "wx" });
  return secret;
}

function hashPairingCode(code: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(code).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getSessionOperator(database: VeyraDatabase, token: string | undefined): { id: string; username: string } | null {
  if (!token) return null;

  const row = database.prepare(`
    SELECT operators.id, operators.username, sessions.expires_at
    FROM sessions
    INNER JOIN operators ON operators.id = sessions.operator_id
    WHERE sessions.token_hash = ?
  `).get(hashSessionToken(token)) as { id: string; username: string; expires_at: string } | undefined;

  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
    return null;
  }

  return { id: row.id, username: row.username };
}

function getAuthenticatedOperator(database: VeyraDatabase, request: FastifyRequest, reply: FastifyReply): { id: string; username: string } | null {
  const operator = getSessionOperator(database, request.cookies[SESSION_COOKIE]);
  if (!operator) {
    reply.code(401).send({ error: "Authentication required" });
    return null;
  }
  return operator;
}

function setSessionCookie(reply: FastifyReply, token: string, secureCookies: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const database = openDatabase(options.databasePath);
  let setup: ReturnType<typeof readSetupKey>;
  let pairingSecret: Buffer;
  try {
    setup = readSetupKey(database, options);
    pairingSecret = readPairingSecret(options);
  } catch (error) {
    database.close();
    throw error;
  }
  const secureCookies = Boolean(options.https) || options.secureCookies === true ||
    process.env.VEYRA_COOKIE_SECURE === "true";
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    ...(options.https ? { https: options.https } : {}),
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    if (options.https) reply.header("Strict-Transport-Security", "max-age=31536000");
    return payload;
  });

  if (setup.generated && setup.key) {
    app.log.warn({ setupKey: setup.key }, "Veyra first-run setup key — enter this in the dashboard");
  }

  app.register(cookie);
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.addHook("onClose", async () => {
    database.close();
  });

  app.get("/api/v1/health", async () => ({
    status: "ok",
    service: "veyra-server",
    version: "0.1.0",
  }));

  app.get("/api/v1/setup/status", async () => {
    const result = database.prepare("SELECT COUNT(*) AS count FROM operators").get() as { count: number };
    return { setupRequired: result.count === 0 };
  });

  app.post<{ Body: SetupBody }>("/api/v1/setup", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = request.body ?? {};
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const suppliedKey = typeof body.setupKey === "string" ? body.setupKey : "";

    if (!setup.key || !safeEqual(suppliedKey, setup.key)) {
      return reply.code(403).send({ error: "Invalid or expired setup key" });
    }
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
      return reply.code(400).send({ error: "Username must be 3–32 characters and use letters, numbers, _ or -" });
    }
    if (password.length < 12 || password.length > 256) {
      return reply.code(400).send({ error: "Password must be between 12 and 256 characters" });
    }

    const existing = database.prepare("SELECT COUNT(*) AS count FROM operators").get() as { count: number };
    if (existing.count > 0) {
      return reply.code(409).send({ error: "Initial setup has already been completed" });
    }

    const operatorId = randomUUID();
    const createdAt = new Date().toISOString();
    const passwordHash = await hashPassword(password);

    try {
      const createOperator = database.transaction(() => {
        const currentCount = database.prepare("SELECT COUNT(*) AS count FROM operators").get() as { count: number };
        if (currentCount.count > 0) throw new Error("SETUP_ALREADY_COMPLETED");
        database.prepare("INSERT INTO operators (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
          .run(operatorId, username, passwordHash, createdAt);
      });
      createOperator();
    } catch (error) {
      if (error instanceof Error && error.message === "SETUP_ALREADY_COMPLETED") {
        return reply.code(409).send({ error: "Initial setup has already been completed" });
      }
      request.log.error(error, "Could not create initial Veyra operator");
      return reply.code(409).send({ error: "Initial setup could not be completed" });
    }

    if (setup.path) {
      try { rmSync(setup.path, { force: true }); } catch (error) {
        request.log.error(error, "Could not remove used setup key file");
      }
    }

    const session = createSession(database, operatorId);
    setSessionCookie(reply, session.token, secureCookies);
    return reply.code(201).send({ authenticated: true, operator: { id: operatorId, username } });
  });

  app.get("/api/v1/auth/session", async (request) => {
    const operator = getSessionOperator(database, request.cookies[SESSION_COOKIE]);
    return operator
      ? { authenticated: true, operator }
      : { authenticated: false, operator: null };
  });

  app.post<{ Body: LoginBody }>("/api/v1/auth/session", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const body = request.body ?? {};
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length === 0 || password.length > 256) {
      return reply.code(400).send({ error: "Password must be between 1 and 256 characters" });
    }

    const operator = database.prepare("SELECT id, username, password_hash FROM operators WHERE username = ?")
      .get(username) as { id: string; username: string; password_hash: string } | undefined;

    if (!operator || !(await verifyPassword(password, operator.password_hash))) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }

    const session = createSession(database, operator.id);
    setSessionCookie(reply, session.token, secureCookies);
    return { authenticated: true, operator: { id: operator.id, username: operator.username } };
  });

  app.delete("/api/v1/auth/session", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { authenticated: false };
  });

  app.post("/api/v1/devices/pairing-codes", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const operator = getAuthenticatedOperator(database, request, reply);
    if (!operator) return;

    const code = randomInt(0, 1_000_000_000_000).toString().padStart(12, "0");
    database.prepare("DELETE FROM pairing_codes WHERE expires_at <= ? OR used_at IS NOT NULL")
      .run(new Date().toISOString());
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

    database.prepare(`
      INSERT INTO pairing_codes (id, code_hash, created_by, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), hashPairingCode(code, pairingSecret), operator.id, expiresAt, now.toISOString());

    return reply.code(201).send({ code, expiresAt });
  });

  app.get("/api/v1/devices", async (request, reply) => {
    const operator = getAuthenticatedOperator(database, request, reply);
    if (!operator) return;

    const rows = database.prepare(`
      SELECT id, name, platform, software_version, last_seen_at, last_ip,
             playback_mode, ndi_source_name, uptime_seconds, created_at,
             credential_revoked_at
      FROM devices
      ORDER BY name COLLATE NOCASE ASC
    `).all() as Array<{
      id: string;
      name: string;
      platform: string;
      software_version: string;
      last_seen_at: string | null;
      last_ip: string | null;
      playback_mode: string;
      ndi_source_name: string | null;
      uptime_seconds: number | null;
      created_at: string;
      credential_revoked_at: string | null;
    }>;

    const now = Date.now();
    return {
      devices: rows.map((device) => {
        const age = device.last_seen_at ? now - Date.parse(device.last_seen_at) : Number.POSITIVE_INFINITY;
        const status = age <= 45_000 ? "online" : age <= 120_000 ? "stale" : "offline";
        return {
          id: device.id,
          name: device.name,
          status,
          platform: device.platform,
          softwareVersion: device.software_version,
          lastSeenAt: device.last_seen_at,
          lastIp: device.last_ip,
          playbackMode: device.playback_mode,
          ndiSourceName: device.ndi_source_name,
          uptimeSeconds: device.uptime_seconds,
          createdAt: device.created_at,
          credentialRevokedAt: device.credential_revoked_at,
          credentialStatus: device.credential_revoked_at ? "revoked" : "active",
        };
      }),
    };
  });

  app.delete<{ Params: { deviceId: string } }>("/api/v1/devices/:deviceId", async (request, reply) => {
    const operator = getAuthenticatedOperator(database, request, reply);
    if (!operator) return;

    const result = database.prepare("DELETE FROM devices WHERE id = ? AND credential_revoked_at IS NOT NULL")
      .run(request.params.deviceId);
    if (result.changes === 0) {
      return reply.code(409).send({ error: "Revoke the device credential before removing the device" });
    }
    return reply.code(204).send();
  });

  app.post<{ Params: { deviceId: string } }>("/api/v1/devices/:deviceId/revoke", async (request, reply) => {
    const operator = getAuthenticatedOperator(database, request, reply);
    if (!operator) return;

    const result = database.prepare(`
      UPDATE devices
      SET credential_revoked_at = COALESCE(credential_revoked_at, ?), updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), new Date().toISOString(), request.params.deviceId);
    if (result.changes === 0) {
      return reply.code(404).send({ error: "Device not found" });
    }
    return { revoked: true };
  });

  app.post<{ Body: { code?: unknown; deviceName?: unknown; platform?: unknown; version?: unknown } }>(
    "/api/v1/receiver/pair",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body ?? {};
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const deviceName = typeof body.deviceName === "string" ? body.deviceName.trim() : "";
      const platform = typeof body.platform === "string" ? body.platform.trim().slice(0, 80) : "unknown";
      const version = typeof body.version === "string" ? body.version.trim().slice(0, 40) : "unknown";

      if (!/^\d{12}$/.test(code)) {
        return reply.code(400).send({ error: "Pairing code must contain 12 digits" });
      }
      if (deviceName.length < 1 || deviceName.length > 64) {
        return reply.code(400).send({ error: "Device name must be between 1 and 64 characters" });
      }

      const deviceId = randomUUID();
      const deviceToken = randomBytes(32).toString("base64url");
      const now = new Date().toISOString();

      const pairDevice = database.transaction(() => {
        const pairing = database.prepare(`
          SELECT id, expires_at, used_at
          FROM pairing_codes
          WHERE code_hash = ?
        `).get(hashPairingCode(code, pairingSecret)) as { id: string; expires_at: string; used_at: string | null } | undefined;

        if (!pairing || pairing.used_at || Date.parse(pairing.expires_at) <= Date.now()) return false;

        const used = database.prepare("UPDATE pairing_codes SET used_at = ? WHERE id = ? AND used_at IS NULL")
          .run(now, pairing.id);
        if (used.changes !== 1) return false;

        database.prepare(`
          INSERT INTO devices (
            id, name, device_token_hash, platform, software_version,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(deviceId, deviceName, hashSessionToken(deviceToken), platform || "unknown", version || "unknown", now, now);

        return true;
      });

      if (!pairDevice()) {
        return reply.code(403).send({ error: "Pairing code is invalid, expired, or already used" });
      }

      return reply.code(201).send({
        deviceId,
        deviceToken,
        heartbeatIntervalSeconds: 15,
      });
    },
  );

  app.post<{ Body: { version?: unknown; platform?: unknown; uptimeSeconds?: unknown; playbackMode?: unknown; ndiSourceName?: unknown } }>(
    "/api/v1/receiver/heartbeat",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const authorization = request.headers.authorization ?? "";
      const deviceToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
      if (!deviceToken) return reply.code(401).send({ error: "Device authentication required" });

      const device = database.prepare("SELECT id FROM devices WHERE device_token_hash = ? AND credential_revoked_at IS NULL")
        .get(hashSessionToken(deviceToken)) as { id: string } | undefined;
      if (!device) return reply.code(401).send({ error: "Invalid device credential" });

      const body = request.body ?? {};
      const version = typeof body.version === "string" ? body.version.trim().slice(0, 40) : "unknown";
      const platform = typeof body.platform === "string" ? body.platform.trim().slice(0, 80) : "unknown";
      const uptimeSeconds = typeof body.uptimeSeconds === "number" &&
        Number.isSafeInteger(body.uptimeSeconds) && body.uptimeSeconds >= 0
        ? body.uptimeSeconds
        : null;
      const allowedModes = new Set(["ndi", "fallback", "idle", "error", "unknown"]);
      const playbackMode = typeof body.playbackMode === "string" && allowedModes.has(body.playbackMode)
        ? body.playbackMode
        : "unknown";
      const ndiSourceName = typeof body.ndiSourceName === "string"
        ? body.ndiSourceName.slice(0, 160)
        : null;
      const now = new Date().toISOString();

      database.prepare(`
        UPDATE devices
        SET last_seen_at = ?, last_ip = ?, software_version = ?, platform = ?,
            playback_mode = ?, ndi_source_name = ?, uptime_seconds = ?, updated_at = ?
        WHERE id = ?
      `).run(now, request.ip, version || "unknown", platform || "unknown", playbackMode, ndiSourceName, uptimeSeconds, now, device.id);

      return { accepted: true, serverTime: now };
    },
  );

  return app;
}
