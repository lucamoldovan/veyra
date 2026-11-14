import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";

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
