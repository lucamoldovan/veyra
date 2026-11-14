import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";

test("health endpoint reports the local server status", async () => {
  const app = buildApp();

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
  const app = buildApp();

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
