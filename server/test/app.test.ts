import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";

function createTestApp() {
  return buildApp({
    databasePath: ":memory:",
    setupKey: "test-setup-key",
  });
}

test("health endpoint reports the local server status", async () => {
  const app = createTestApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(response.json(), {
      status: "ok",
      service: "veyra-server",
      version: "0.1.0",
    });
  } finally {
    await app.close();
  }
});

test("unknown API routes return 404", async () => {
  const app = createTestApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/not-a-route",
    });

    assert.equal(response.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("first-run setup creates an operator and a session", async () => {
  const app = createTestApp();

  try {
    const before = await app.inject({ method: "GET", url: "/api/v1/setup/status" });
    assert.deepEqual(before.json(), { setupRequired: true });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/setup",
      payload: { setupKey: "wrong", username: "admin", password: "a-very-long-test-password" },
    });
    assert.equal(invalid.statusCode, 403);

    const setup = await app.inject({
      method: "POST",
      url: "/api/v1/setup",
      payload: { setupKey: "test-setup-key", username: "admin", password: "a-very-long-test-password" },
    });
    assert.equal(setup.statusCode, 201);
    assert.equal(setup.json().authenticated, true);
    const cookie = setup.headers["set-cookie"];
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);

    const after = await app.inject({ method: "GET", url: "/api/v1/setup/status" });
    assert.deepEqual(after.json(), { setupRequired: false });

    const session = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie: String(cookie).split(";")[0] },
    });
    assert.equal(session.json().authenticated, true);
    assert.equal(session.json().operator.username, "admin");
  } finally {
    await app.close();
  }
});

test("operator can log in and log out", async () => {
  const app = createTestApp();

  try {
    await app.inject({
      method: "POST",
      url: "/api/v1/setup",
      payload: { setupKey: "test-setup-key", username: "admin", password: "a-very-long-test-password" },
    });

    const failedLogin = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session",
      payload: { username: "admin", password: "incorrect-password" },
    });
    assert.equal(failedLogin.statusCode, 401);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session",
      payload: { username: "admin", password: "a-very-long-test-password" },
    });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().authenticated, true);

    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const logout = await app.inject({
      method: "DELETE",
      url: "/api/v1/auth/session",
      headers: { cookie },
    });
    assert.deepEqual(logout.json(), { authenticated: false });

    const session = await app.inject({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: { cookie },
    });
    assert.equal(session.json().authenticated, false);
  } finally {
    await app.close();
  }
});

test("operator can pair a receiver and read its heartbeat state", async () => {
  const app = createTestApp();

  try {
    await app.inject({
      method: "POST",
      url: "/api/v1/setup",
      payload: { setupKey: "test-setup-key", username: "admin", password: "a-very-long-test-password" },
    });

    const unauthenticatedList = await app.inject({ method: "GET", url: "/api/v1/devices" });
    assert.equal(unauthenticatedList.statusCode, 401);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session",
      payload: { username: "admin", password: "a-very-long-test-password" },
    });
    const operatorCookie = String(login.headers["set-cookie"]).split(";")[0];

    const pairingCodeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/devices/pairing-codes",
      headers: { cookie: operatorCookie },
    });
    assert.equal(pairingCodeResponse.statusCode, 201);
    const pairingCode = pairingCodeResponse.json().code as string;
    assert.match(pairingCode, /^\d{8}$/);

    const paired = await app.inject({
      method: "POST",
      url: "/api/v1/receiver/pair",
      payload: {
        code: pairingCode,
        deviceName: "Lobby Display",
        platform: "linux-x86_64",
        version: "0.1.0",
      },
    });
    assert.equal(paired.statusCode, 201);
    const credentials = paired.json() as { deviceId: string; deviceToken: string; heartbeatIntervalSeconds: number };
    assert.ok(credentials.deviceId);
    assert.ok(credentials.deviceToken);
    assert.equal(credentials.heartbeatIntervalSeconds, 15);

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/receiver/pair",
      payload: { code: pairingCode, deviceName: "Second Display" },
    });
    assert.equal(replay.statusCode, 403);

    const initialList = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { cookie: operatorCookie },
    });
    assert.equal(initialList.json().devices.length, 1);
    assert.equal(initialList.json().devices[0].status, "offline");

    const heartbeat = await app.inject({
      method: "POST",
      url: "/api/v1/receiver/heartbeat",
      headers: { authorization: `Bearer ${credentials.deviceToken}` },
      payload: {
        version: "0.1.1",
        platform: "linux-x86_64",
        uptimeSeconds: 120,
        playbackMode: "ndi",
        ndiSourceName: "Camera 1",
      },
    });
    assert.equal(heartbeat.statusCode, 200);
    assert.equal(heartbeat.json().accepted, true);

    const updatedList = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { cookie: operatorCookie },
    });
    const device = updatedList.json().devices[0];
    assert.equal(device.status, "online");
    assert.equal(device.name, "Lobby Display");
    assert.equal(device.softwareVersion, "0.1.1");
    assert.equal(device.playbackMode, "ndi");
    assert.equal(device.ndiSourceName, "Camera 1");
  } finally {
    await app.close();
  }
});

test("database initializes a versioned schema", () => {
  const database = openDatabase(":memory:");

  try {
    assert.equal(database.pragma("user_version", { simple: true }), 1);
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all() as Array<{ name: string }>;
    assert.deepEqual(
      tables.map((table) => table.name),
      ["devices", "operators", "pairing_codes", "sessions"],
    );
  } finally {
    database.close();
  }
});

test("secure cookie policy can be enforced by the HTTPS deployment", async () => {
  const app = buildApp({
    databasePath: ":memory:",
    setupKey: "test-setup-key",
    secureCookies: true,
  });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/setup",
      payload: {
        setupKey: "test-setup-key",
        username: "admin",
        password: "a-very-long-test-password",
      },
    });

    assert.equal(response.statusCode, 201);
    assert.match(String(response.headers["set-cookie"]), /; Secure/i);

    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session",
      payload: { username: "admin", password: "a-very-long-test-password" },
    });
    assert.equal(login.statusCode, 200);
    assert.match(String(login.headers["set-cookie"]), /; Secure/i);
  } finally {
    await app.close();
  }
});
