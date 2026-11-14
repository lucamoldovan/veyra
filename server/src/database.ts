import Database from "better-sqlite3";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type VeyraDatabase = Database.Database;

const CURRENT_SCHEMA_VERSION = 7;

export function openDatabase(databasePath = process.env.VEYRA_DATABASE_PATH ?? "data/veyra.sqlite"): VeyraDatabase {
  const resolvedPath = databasePath === ":memory:" ? databasePath : resolve(databasePath);

  if (resolvedPath !== ":memory:") {
    const directory = dirname(resolvedPath);
    const absoluteDirectory = resolve(directory);
    const homeDirectory = process.env.HOME ? resolve(process.env.HOME) : "";
    if (absoluteDirectory === process.cwd() || (homeDirectory && absoluteDirectory === homeDirectory)) {
      throw new Error("Veyra database must live in a dedicated private subdirectory");
    }
    const unsafeTargets = new Set([
      "/", "/tmp", "/var", "/var/cache", "/var/lib", "/home", "/root",
      "/etc", "/usr", "/opt", "/run", "/mnt", "/media", "/dev", "/proc",
      "/sys", "/boot",
    ]);
    if (unsafeTargets.has(absoluteDirectory)) {
      throw new Error("Veyra database must live in a dedicated private directory");
    }
    mkdirSync(absoluteDirectory, { recursive: true, mode: 0o700 });
    const directoryInfo = lstatSync(absoluteDirectory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
      throw new Error("Veyra database directory must be a real directory, not a symlink");
    }
    chmodSync(absoluteDirectory, 0o700);

    if (existsSync(resolvedPath)) {
      const databaseInfo = lstatSync(resolvedPath);
      if (!databaseInfo.isFile() || databaseInfo.isSymbolicLink()) {
        throw new Error("Veyra database path must be a regular file, not a symlink");
      }
      chmodSync(resolvedPath, 0o600);
    } else {
      const descriptor = openSync(resolvedPath, "wx", 0o600);
      closeSync(descriptor);
    }
  }

  const database = new Database(resolvedPath);
  if (resolvedPath !== ":memory:") chmodSync(resolvedPath, 0o600);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  const currentVersion = database.pragma("user_version", { simple: true }) as number;
  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    database.close();
    throw new Error(
      `Database schema version ${currentVersion} is newer than this Veyra server supports (${CURRENT_SCHEMA_VERSION})`,
    );
  }

  const migrate = database.transaction(() => {
    if (currentVersion < 1) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS operators (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL COLLATE NOCASE UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS sessions_operator_id_idx ON sessions(operator_id);
        CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

        CREATE TABLE IF NOT EXISTS pairing_codes (
          id TEXT PRIMARY KEY,
          code_hash TEXT NOT NULL UNIQUE,
          created_by TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS pairing_codes_expires_at_idx ON pairing_codes(expires_at);

        CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          device_token_hash TEXT NOT NULL UNIQUE,
          platform TEXT NOT NULL DEFAULT 'unknown',
          software_version TEXT NOT NULL DEFAULT 'unknown',
          last_seen_at TEXT,
          last_ip TEXT,
          playback_mode TEXT NOT NULL DEFAULT 'unknown',
          ndi_source_name TEXT,
          uptime_seconds INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS devices_last_seen_at_idx ON devices(last_seen_at);
      `);
      database.pragma("user_version = 1");
    }

    if (currentVersion < 2) {
      database.exec(`
        ALTER TABLE devices ADD COLUMN credential_revoked_at TEXT;
        CREATE INDEX IF NOT EXISTS devices_credential_revoked_at_idx
          ON devices(credential_revoked_at);
      `);
      database.pragma("user_version = 2");
    }

    if (currentVersion < 3) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS media_assets (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          storage_key TEXT NOT NULL UNIQUE,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
          sha256 TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS media_assets_created_at_idx
          ON media_assets(created_at DESC);

        CREATE TABLE IF NOT EXISTS playlists (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS playlists_name_idx
          ON playlists(name COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS playlist_items (
          id TEXT PRIMARY KEY,
          playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
          position INTEGER NOT NULL CHECK (position >= 0),
          duration_seconds INTEGER NOT NULL CHECK (duration_seconds BETWEEN 1 AND 3600),
          UNIQUE (playlist_id, position)
        );

        CREATE INDEX IF NOT EXISTS playlist_items_media_id_idx
          ON playlist_items(media_id);
      `);
      database.pragma("user_version = 3");
    }

    if (currentVersion < 4) {
      database.exec(`
        ALTER TABLE devices
          ADD COLUMN discovered_sources_json TEXT NOT NULL DEFAULT '[]';
      `);
      database.pragma("user_version = 4");
    }
    if (currentVersion < 5) {
      database.exec(`
        ALTER TABLE devices ADD COLUMN config_version INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE devices ADD COLUMN assigned_ndi_source_name TEXT;
        ALTER TABLE devices ADD COLUMN assigned_ndi_source_address TEXT;
        ALTER TABLE devices ADD COLUMN fallback_playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS devices_fallback_playlist_id_idx
          ON devices(fallback_playlist_id);
      `);
      database.pragma("user_version = 5");
    }

    if (currentVersion < 6) {
      database.exec(`
        ALTER TABLE playlists ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
        CREATE TRIGGER IF NOT EXISTS devices_fallback_playlist_deleted
        BEFORE DELETE ON playlists
        BEGIN
          UPDATE devices
          SET config_version = config_version + 1,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE fallback_playlist_id = OLD.id;
        END;
      `);
      database.pragma("user_version = 6");
    }
    if (currentVersion < 7) {
      database.exec(`
        CREATE TABLE device_commands (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          command_type TEXT NOT NULL CHECK (command_type IN ('restart')),
          status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'restarting', 'completed', 'failed', 'timed_out')),
          requested_by TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
          created_at TEXT NOT NULL, expires_at TEXT NOT NULL, claimed_at TEXT, completed_at TEXT, result_message TEXT
        );
        CREATE INDEX device_commands_device_created_idx ON device_commands(device_id, created_at DESC);
        CREATE INDEX device_commands_pending_idx ON device_commands(status, expires_at);
      `);
      database.pragma("user_version = 7");
    }
    if (currentVersion < 8) {
      database.exec(`
        ALTER TABLE device_commands RENAME TO device_commands_v7;
        CREATE TABLE device_commands (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
          command_type TEXT NOT NULL CHECK (command_type IN ('restart', 'reboot')),
          status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'restarting', 'completed', 'failed', 'timed_out')),
          requested_by TEXT NOT NULL REFERENCES operators(id) ON DELETE RESTRICT,
          created_at TEXT NOT NULL, expires_at TEXT NOT NULL, claimed_at TEXT, completed_at TEXT, result_message TEXT
        );
        INSERT INTO device_commands SELECT * FROM device_commands_v7;
        DROP TABLE device_commands_v7;
        CREATE INDEX device_commands_device_created_idx ON device_commands(device_id, created_at DESC);
        CREATE INDEX device_commands_pending_idx ON device_commands(status, expires_at);
      `);
      database.pragma("user_version = 8");
    }
  });

  try {
    migrate();
    const now = new Date().toISOString();
    database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    database.prepare("DELETE FROM pairing_codes WHERE expires_at <= ? OR used_at IS NOT NULL").run(now);
  } catch (error) {
    database.close();
    throw error;
  }

  return database;
}
