import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import pino from 'pino';
import type { WorldEvent, WorldState } from './types.js';

const log = pino({ name: 'harbor:db' });

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized — call initDb() first');
  return db;
}

export function initDb(): Database.Database {
  const dbDir = path.join(process.env.HOME || '/tmp', 'nanoclaw/data/harbor');
  fs.mkdirSync(dbDir, { recursive: true });

  const dbPath = path.join(dbDir, 'harbor.db');
  log.info({ path: dbPath }, 'Opening database');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sequence INTEGER UNIQUE NOT NULL,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      agent_id TEXT,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS state_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      state TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user'
    );

    CREATE INDEX IF NOT EXISTS idx_events_sequence ON events(sequence);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    CREATE INDEX IF NOT EXISTS idx_events_agent_id ON events(agent_id);
  `);

  log.info('Database initialized');
  return db;
}

// --- Event persistence ---

const insertEventStmt = () =>
  getDb().prepare<[number, number, string, string | null, string]>(
    'INSERT INTO events (sequence, timestamp, type, agent_id, data) VALUES (?, ?, ?, ?, ?)',
  );

export function persistEvent(event: WorldEvent & { sequence: number }): void {
  insertEventStmt().run(
    event.sequence,
    event.timestamp,
    event.type,
    event.agentId ?? null,
    JSON.stringify(event.data),
  );
}

export function getEventsSince(seq: number): WorldEvent[] {
  const rows = getDb()
    .prepare('SELECT * FROM events WHERE sequence > ? ORDER BY sequence ASC')
    .all(seq) as Array<{
    id: number;
    sequence: number;
    timestamp: number;
    type: string;
    agent_id: string | null;
    data: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    timestamp: r.timestamp,
    type: r.type as WorldEvent['type'],
    agentId: r.agent_id ?? undefined,
    data: JSON.parse(r.data),
  }));
}

// --- Snapshot persistence ---

export function saveSnapshot(state: WorldState): void {
  getDb()
    .prepare('INSERT INTO state_snapshots (timestamp, state) VALUES (?, ?)')
    .run(Date.now(), JSON.stringify(state));
}

export function getLatestSnapshot(): WorldState | null {
  const row = getDb()
    .prepare('SELECT state FROM state_snapshots ORDER BY id DESC LIMIT 1')
    .get() as { state: string } | undefined;

  if (!row) return null;
  return JSON.parse(row.state) as WorldState;
}

// --- User persistence ---

export function getUser(username: string): {
  id: string;
  username: string;
  password_hash: string;
  role: string;
} | null {
  const row = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as
    | { id: string; username: string; password_hash: string; role: string }
    | undefined;

  return row ?? null;
}

export function createUser(id: string, username: string, passwordHash: string, role: string): void {
  getDb()
    .prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(id, username, passwordHash, role);
}

export function closeDb(): void {
  if (db) {
    db.close();
    log.info('Database closed');
  }
}
