import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/database.js";

function createTestApp() {
  return buildApp({
    databasePath: ":memory:",
    setupKey: "test-setup-key",
    pairingSecret: "test-pairing-secret-with-at-least-32-bytes",
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
    assert.match(pairingCode, /^\d{12}$/);

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
    const unauthenticatedRevoke = await app.inject({
      method: "POST",
      url: `/api/v1/devices/${credentials.deviceId}/revoke`,
    });
    assert.equal(unauthenticatedRevoke.statusCode, 401);

    const removeActive = await app.inject({
      method: "DELETE",
      url: `/api/v1/devices/${credentials.deviceId}`,
      headers: { cookie: operatorCookie },
    });
    assert.equal(removeActive.statusCode, 409);

    const revoke = await app.inject({
      method: "POST",
      url: `/api/v1/devices/${credentials.deviceId}/revoke`,
      headers: { cookie: operatorCookie },
    });
    assert.equal(revoke.statusCode, 200);
    assert.equal(revoke.json().revoked, true);

    const revokedHeartbeat = await app.inject({
      method: "POST",
      url: "/api/v1/receiver/heartbeat",
      headers: { authorization: `Bearer ${credentials.deviceToken}` },
      payload: { playbackMode: "ndi" },
    });
    assert.equal(revokedHeartbeat.statusCode, 401);

    const revokedList = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { cookie: operatorCookie },
    });
    assert.equal(revokedList.json().devices[0].credentialStatus, "revoked");

    const removeRevoked = await app.inject({
      method: "DELETE",
      url: `/api/v1/devices/${credentials.deviceId}`,
      headers: { cookie: operatorCookie },
    });
    assert.equal(removeRevoked.statusCode, 204);

    const afterRemoval = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      headers: { cookie: operatorCookie },
    });
    assert.equal(afterRemoval.json().devices.length, 0);
  } finally {
    await app.close();
  }
});





test("media library validates image signatures and protects playlist references", async () => {
  const directory = mkdtempSync(join(tmpdir(), "veyra-media-test-"));
  const app = buildApp({
    databasePath: ":memory:",
    setupKey: "test-setup-key",
    pairingSecret: "test-pairing-secret-with-at-least-32-bytes",
    mediaDirectory: join(directory, "media"),
  });

  try {
    await app.inject({
      method: "POST",
      url: "/api/v1/setup",
      payload: { setupKey: "test-setup-key", username: "admin", password: "a-very-long-test-password" },
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/session",
      payload: { username: "admin", password: "a-very-long-test-password" },
    });
    const cookie = String(login.headers["set-cookie"]).split(";")[0];

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const invalidImage = await app.inject({
      method: "POST",
      url: "/api/v1/media",
      headers: { cookie, "content-type": "image/png" },
      payload: Buffer.from("not an image"),
    });
    assert.equal(invalidImage.statusCode, 415);

    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/media",
      headers: {
        cookie,
        "content-type": "image/png",
        "x-veyra-filename": encodeURIComponent("../Lobby screen.png"),
      },
      payload: png,
    });
    assert.equal(upload.statusCode, 201);
    const media = upload.json() as { id: string; name: string; contentUrl: string; sizeBytes: number };
    assert.equal(media.name, ".._Lobby screen.png");
    assert.equal(media.sizeBytes, png.length);

    const content = await app.inject({
      method: "GET",
      url: media.contentUrl,
      headers: { cookie },
    });
    assert.equal(content.statusCode, 200);
    assert.equal(content.headers["content-type"], "image/png");
    assert.deepEqual(content.rawPayload, png);

    const createPlaylist = await app.inject({
      method: "POST",
      url: "/api/v1/playlists",
      headers: { cookie },
      payload: { name: "Lobby rotation", description: "Welcome screen sequence" },
    });
    assert.equal(createPlaylist.statusCode, 201);
    const playlistId = createPlaylist.json().id as string;

    const invalidPlaylist = await app.inject({
      method: "PUT",
      url: `/api/v1/playlists/${playlistId}`,
      headers: { cookie },
      payload: {
        name: "Lobby rotation",
        description: "",
        items: [{ mediaId: media.id, durationSeconds: 0 }],
      },
    });
    assert.equal(invalidPlaylist.statusCode, 400);

    const updatePlaylist = await app.inject({
      method: "PUT",
      url: `/api/v1/playlists/${playlistId}`,
      headers: { cookie },
      payload: {
        name: "Lobby rotation",
        description: "Welcome screen sequence",
        items: [{ mediaId: media.id, durationSeconds: 15 }],
      },
    });
    assert.equal(updatePlaylist.statusCode, 200);
    assert.equal(updatePlaylist.json().itemCount, 1);

    const playlist = await app.inject({
      method: "GET",
      url: `/api/v1/playlists/${playlistId}`,
      headers: { cookie },
    });
    assert.equal(playlist.json().items[0].durationSeconds, 15);
    assert.equal(playlist.json().items[0].mediaName, ".._Lobby screen.png");

    const blockedDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/media/${media.id}`,
      headers: { cookie },
    });
    assert.equal(blockedDelete.statusCode, 409);

    const deletePlaylist = await app.inject({
      method: "DELETE",
      url: `/api/v1/playlists/${playlistId}`,
      headers: { cookie },
    });
    assert.equal(deletePlaylist.statusCode, 204);

    const deleteMedia = await app.inject({
      method: "DELETE",
      url: `/api/v1/media/${media.id}`,
      headers: { cookie },
    });
    assert.equal(deleteMedia.statusCode, 204);

    const mediaList = await app.inject({
      method: "GET",
      url: "/api/v1/media",
      headers: { cookie },
    });
    assert.equal(mediaList.json().media.length, 0);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backup command creates a consistent database and pairing-secret backup", () => {
  const directory = mkdtempSync(join(tmpdir(), "veyra-backup-test-"));
  const databasePath = join(directory, "source.sqlite");
  const pairingSecretPath = join(directory, "pairing-secret");
  const backupDirectory = join(directory, "backups");

  try {
    const source = openDatabase(databasePath);
    source.close();
    writeFileSync(pairingSecretPath, "a".repeat(64) + "\n", { mode: 0o600 });

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/backup.ts", backupDirectory],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          VEYRA_DATABASE_PATH: databasePath,
          VEYRA_PAIRING_SECRET_PATH: pairingSecretPath,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);

    const files = readdirSync(backupDirectory);
    const manifestName = files.find((name) => name.endsWith(".json"));
    assert.ok(manifestName);
    const manifest = JSON.parse(readFileSync(join(backupDirectory, manifestName), "utf8")) as {
      databaseFile: string;
      pairingSecretFile: string;
    };

    const backupDatabase = openDatabase(join(backupDirectory, manifest.databaseFile));
    try {
      assert.equal(backupDatabase.pragma("user_version", { simple: true }), 3);
    } finally {
      backupDatabase.close();
    }
    assert.equal(
      readFileSync(join(backupDirectory, manifest.pairingSecretFile), "utf8"),
      "a".repeat(64) + "\n",
    );
    assert.equal(statSync(join(backupDirectory, manifest.databaseFile)).mode & 0o777, 0o600);
    assert.equal(statSync(join(backupDirectory, manifest.pairingSecretFile)).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid pairing secret fails startup without leaking the database handle", () => {
  const directory = mkdtempSync(join(tmpdir(), "veyra-invalid-secret-"));
  const databasePath = join(directory, "veyra.sqlite");
  const pairingSecretPath = join(directory, "pairing-secret");

  try {
    writeFileSync(pairingSecretPath, "not-a-valid-secret", { mode: 0o600 });
    assert.throws(
      () => buildApp({ databasePath, setupKey: "test-setup-key", pairingSecretPath }),
      /pairing secret file is invalid/i,
    );

    const database = openDatabase(databasePath);
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pairing secret is generated with restrictive permissions and remains stable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "veyra-pairing-secret-"));
  const databasePath = join(directory, "veyra.sqlite");
  const pairingSecretPath = join(directory, "pairing-secret");

  try {
    const firstApp = buildApp({
      databasePath,
      setupKey: "test-setup-key",
      pairingSecretPath,
    });
    await firstApp.close();

    const firstSecret = readFileSync(pairingSecretPath, "utf8");
    assert.match(firstSecret.trim(), /^[a-f0-9]{64}$/i);
    assert.equal(statSync(pairingSecretPath).mode & 0o777, 0o600);

    const secondApp = buildApp({
      databasePath,
      setupKey: "test-setup-key",
      pairingSecretPath,
    });
    await secondApp.close();
    assert.equal(readFileSync(pairingSecretPath, "utf8"), firstSecret);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("database initializes a versioned schema", () => {
  const database = openDatabase(":memory:");

  try {
    assert.equal(database.pragma("user_version", { simple: true }), 3);
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all() as Array<{ name: string }>;
    assert.deepEqual(
      tables.map((table) => table.name),
      ["devices", "media_assets", "operators", "pairing_codes", "playlist_items", "playlists", "sessions"],
    );
  } finally {
    database.close();
  }
});


test("database upgrades a populated version-one schema without losing devices", () => {
  const directory = mkdtempSync(join(tmpdir(), "veyra-migration-"));
  const databasePath = join(directory, "veyra.sqlite");

  try {
    const legacy = openDatabase(databasePath);
    legacy.prepare(
      "INSERT INTO operators (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
    ).run("operator-1", "admin", "test-hash", "2026-01-01T00:00:00.000Z");
    legacy.prepare(`
      INSERT INTO devices (
        id, name, device_token_hash, platform, software_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("device-1", "Lobby", "token-hash", "linux-x86_64", "0.1.0",
      "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    legacy.exec("DROP INDEX devices_credential_revoked_at_idx");
    legacy.exec("ALTER TABLE devices DROP COLUMN credential_revoked_at");
    legacy.exec("DROP TABLE playlist_items; DROP TABLE playlists; DROP TABLE media_assets;");
    legacy.pragma("user_version = 1");
    legacy.close();

    const migrated = openDatabase(databasePath);
    try {
      assert.equal(migrated.pragma("user_version", { simple: true }), 3);
      const device = migrated.prepare(
        "SELECT id, name, credential_revoked_at FROM devices WHERE id = ?",
      ).get("device-1") as { id: string; name: string; credential_revoked_at: string | null };
      assert.deepEqual(device, {
        id: "device-1",
        name: "Lobby",
        credential_revoked_at: null,
      });
      const operatorCount = migrated.prepare("SELECT COUNT(*) AS count FROM operators").get() as { count: number };
      assert.equal(operatorCount.count, 1);
    } finally {
      migrated.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("secure cookie policy can be enforced by the HTTPS deployment", async () => {
  const app = buildApp({
    databasePath: ":memory:",
    setupKey: "test-setup-key",
    pairingSecret: "test-pairing-secret-with-at-least-32-bytes",
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
