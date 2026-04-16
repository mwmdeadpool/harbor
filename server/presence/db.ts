import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import pino from 'pino';
import type { WorldEvent, WorldState } from './types.js';

const log = pino({ name: 'harbor:db' });

let db: Database.Database;

// WAL checkpoint tracking
let eventsSinceCheckpoint = 0;
const WAL_CHECKPOINT_INTERVAL = 1000;

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
      sequence INTEGER NOT NULL DEFAULT 0,
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
    CREATE INDEX IF NOT EXISTS idx_snapshots_sequence ON state_snapshots(sequence);
  `);

  // Migration: add sequence column to state_snapshots if missing
  const cols = db.prepare('PRAGMA table_info(state_snapshots)').all() as Array<{ name: string }>;
  const hasSeqCol = cols.some((c) => c.name === 'sequence');
  if (!hasSeqCol) {
    db.exec('ALTER TABLE state_snapshots ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0');
    db.exec('CREATE INDEX IF NOT EXISTS idx_snapshots_sequence ON state_snapshots(sequence)');
    log.info('Migrated state_snapshots: added sequence column');
  }

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

  // Periodic WAL checkpoint
  eventsSinceCheckpoint += 1;
  if (eventsSinceCheckpoint >= WAL_CHECKPOINT_INTERVAL) {
    walCheckpoint();
  }
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
    .prepare('INSERT INTO state_snapshots (timestamp, sequence, state) VALUES (?, ?, ?)')
    .run(Date.now(), state.sequence, JSON.stringify(state));
}

export function getLatestSnapshot(): { state: WorldState; sequence: number } | null {
  const row = getDb()
    .prepare('SELECT state, sequence FROM state_snapshots ORDER BY id DESC LIMIT 1')
    .get() as { state: string; sequence: number } | undefined;

  if (!row) return null;
  return { state: JSON.parse(row.state) as WorldState, sequence: row.sequence };
}

/**
 * Get the sequence number of the most recent snapshot.
 */
export function getLastSnapshotSequence(): number {
  const row = getDb()
    .prepare('SELECT sequence FROM state_snapshots ORDER BY id DESC LIMIT 1')
    .get() as { sequence: number } | undefined;

  return row?.sequence ?? 0;
}

// --- Snapshot compaction ---

/**
 * Delete all but the N most recent snapshots.
 */
export function compactSnapshots(keepCount: number): number {
  const result = getDb()
    .prepare(
      `DELETE FROM state_snapshots WHERE id NOT IN (
        SELECT id FROM state_snapshots ORDER BY id DESC LIMIT ?
      )`,
    )
    .run(keepCount);

  if (result.changes > 0) {
    log.info({ deleted: result.changes, kept: keepCount }, 'Compacted snapshots');
  }
  return result.changes;
}

/**
 * Delete events with sequence <= the given sequence number.
 * Safe to call after a snapshot covers those events.
 */
export function compactEvents(beforeSequence: number): number {
  const result = getDb().prepare('DELETE FROM events WHERE sequence <= ?').run(beforeSequence);

  if (result.changes > 0) {
    log.info({ deleted: result.changes, beforeSequence }, 'Compacted events');
  }
  return result.changes;
}

/**
 * Get total number of snapshots.
 */
export function getSnapshotCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM state_snapshots').get() as {
    count: number;
  };
  return row.count;
}

/**
 * Get total number of events.
 */
export function getEventCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM events').get() as { count: number };
  return row.count;
}

/**
 * Run compaction after a snapshot: keep last N snapshots and delete events
 * covered by the oldest kept snapshot.
 */
export function runCompaction(keepSnapshots = 5): void {
  try {
    compactSnapshots(keepSnapshots);

    // Find the oldest kept snapshot's sequence — everything before it can be purged
    const row = getDb()
      .prepare(`SELECT sequence FROM state_snapshots ORDER BY id ASC LIMIT 1`)
      .get() as { sequence: number } | undefined;

    if (row && row.sequence > 0) {
      // Delete events before the oldest kept snapshot (not including its sequence,
      // since replay needs events *after* the snapshot sequence)
      compactEvents(row.sequence);
    }
  } catch (err) {
    log.error({ err }, 'Compaction failed');
  }
}

// --- WAL checkpoint ---

/**
 * Force a WAL checkpoint to keep the WAL file from growing unbounded.
 */
export function walCheckpoint(): void {
  try {
    getDb().pragma('wal_checkpoint(TRUNCATE)');
    eventsSinceCheckpoint = 0;
    log.debug('WAL checkpoint completed');
  } catch (err) {
    log.error({ err }, 'WAL checkpoint failed');
  }
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
    // Final WAL checkpoint on shutdown
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      log.info('Final WAL checkpoint completed');
    } catch (err) {
      log.error({ err }, 'Final WAL checkpoint failed');
    }
    db.close();
    log.info('Database closed');
  }
}
