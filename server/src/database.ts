import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type VeyraDatabase = Database.Database;

const CURRENT_SCHEMA_VERSION = 4;

export function openDatabase(databasePath = process.env.VEYRA_DATABASE_PATH ?? "data/veyra.sqlite"): VeyraDatabase {
  const resolvedPath = databasePath === ":memory:" ? databasePath : resolve(databasePath);

  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new Database(resolvedPath);
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
