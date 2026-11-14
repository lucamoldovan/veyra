import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDatabase, type VeyraDatabase } from "./database.js";
import { createSession, hashPassword, SESSION_COOKIE, SESSION_TTL, hashSessionToken, verifyPassword } from "./security.js";

interface BuildAppOptions {
  databasePath?: string;
  setupKeyPath?: string;
  setupKey?: string;
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
  if (operatorCount.count > 0) return { key: null, path: null, generated: false };

  if (options.setupKey) return { key: options.setupKey, path: null, generated: false };

  const setupKeyPath = resolve(options.setupKeyPath ?? process.env.VEYRA_SETUP_KEY_PATH ?? "data/setup-key");
  mkdirSync(dirname(setupKeyPath), { recursive: true });

  if (existsSync(setupKeyPath)) {
    return { key: readFileSync(setupKeyPath, "utf8").trim(), path: setupKeyPath, generated: false };
  }

  const key = randomBytes(24).toString("base64url");
  writeFileSync(setupKeyPath, key + "\n", { mode: 0o600, flag: "wx" });
  return { key, path: setupKeyPath, generated: true };
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

function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.VEYRA_COOKIE_SECURE === "true",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const database = openDatabase(options.databasePath);
  const setup = readSetupKey(database, options);
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
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
    setSessionCookie(reply, session.token);
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

    const operator = database.prepare("SELECT id, username, password_hash FROM operators WHERE username = ?")
      .get(username) as { id: string; username: string; password_hash: string } | undefined;

    if (!operator || !(await verifyPassword(password, operator.password_hash))) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }

    const session = createSession(database, operator.id);
    setSessionCookie(reply, session.token);
    return { authenticated: true, operator: { id: operator.id, username: operator.username } };
  });

  app.delete("/api/v1/auth/session", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { authenticated: false };
  });

  return app;
}
