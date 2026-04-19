import fs from 'node:fs/promises';
import path from 'node:path';
import type express from 'express';
import pino from 'pino';

const log = pino({ name: 'harbor:panels' });

const HA_URL = (process.env.HA_URL || 'http://192.168.10.10:8123').replace(/\/$/, '');
const HA_TOKEN = (() => {
  if (process.env.HA_TOKEN) return process.env.HA_TOKEN.trim();
  const file = process.env.HA_TOKEN_FILE;
  if (!file) return '';
  try {
    return require('node:fs').readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
})();

const WORKSPACE_ROOT =
  process.env.HARBOR_WORKSPACE_ROOT || '/home/mwmdeadpool/nanoclaw/groups/main/workspace';
const STREAM_PATH = path.join(WORKSPACE_ROOT, 'margot', 'stream.md');
const HEARTBEAT_PATH = path.join(WORKSPACE_ROOT, 'memory', 'heartbeat-state.json');

const CAMERA_ALLOWED = new Set(
  (process.env.HARBOR_CAMERAS || 'driveway,front_door,backyard,doorbell')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// ── Camera panel (Frigate via HA proxy) ──────────────────────────────
export async function cameraProxy(req: express.Request, res: express.Response) {
  const camera = String(req.query.camera || '').replace(/^camera\./, '');
  if (!camera || !/^[a-z0-9_]+$/i.test(camera)) {
    res.status(400).json({ error: 'invalid camera id' });
    return;
  }
  if (!CAMERA_ALLOWED.has(camera)) {
    res.status(403).json({ error: 'camera not in allowlist' });
    return;
  }
  if (!HA_TOKEN) {
    res.status(503).json({ error: 'HA token not configured' });
    return;
  }
  try {
    const upstream = await fetch(`${HA_URL}/api/camera_proxy/camera.${camera}`, {
      headers: { Authorization: `Bearer ${HA_TOKEN}` },
    });
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `upstream ${upstream.status}` });
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (err) {
    log.warn({ err, camera }, 'camera proxy failed');
    res.status(502).json({ error: 'upstream fetch failed' });
  }
}

// ── Journal tiles (stream.md parser) ─────────────────────────────────
export interface JournalEntry {
  id: string;
  timestamp: string;
  title: string;
  preview: string;
}

function parseStream(raw: string, limit: number): JournalEntry[] {
  // Entries are separated by "---" on its own line; each begins with a header line
  // like "## 2026-04-19 2:15 AM — Title" or "**2026-04-19 10:50 AM — Title**".
  const blocks = raw.split(/^---\s*$/m);
  const entries: JournalEntry[] = [];
  const headerRe =
    /(?:^\s*##\s*|^\s*\*\*\s*)(?<ts>\d{4}-\d{2}-\d{2}(?:[,]?\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?)\s*(?:—|-|–)\s*(?<title>[^\n*]+)/m;
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const m = trimmed.match(headerRe);
    if (!m || !m.groups) continue;
    const ts = m.groups.ts.trim();
    const title = m.groups.title.replace(/\*+$/g, '').replace(/\[.*$/, '').trim();
    // Preview = first non-header paragraph
    const rest = trimmed.slice(m[0].length).trim();
    const preview =
      rest
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .find((p) => p.length > 0) || '';
    entries.push({
      id: `${ts}-${title.slice(0, 24)}`,
      timestamp: ts,
      title: title.slice(0, 80),
      preview: preview.slice(0, 240),
    });
  }
  // Newest last in the file; return newest first
  return entries.slice(-limit).reverse();
}

export async function journalEntries(req: express.Request, res: express.Response) {
  const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit || '8'), 10) || 8));
  try {
    const raw = await fs.readFile(STREAM_PATH, 'utf8');
    res.json({ entries: parseStream(raw, limit) });
  } catch (err) {
    log.warn({ err, path: STREAM_PATH }, 'journal read failed');
    res.status(503).json({ error: 'journal unavailable' });
  }
}

// ── Health (for system-state lighting) ───────────────────────────────
export type HealthLevel = 'healthy' | 'warn' | 'critical';

export async function systemHealth(_req: express.Request, res: express.Response) {
  try {
    const raw = await fs.readFile(HEARTBEAT_PATH, 'utf8');
    const state = JSON.parse(raw) as { notes?: string; lastQuietBeat?: boolean };
    const notes = (state.notes || '').toLowerCase();
    let level: HealthLevel = 'healthy';
    if (/(critical|fail|down|unreachable|error)/.test(notes)) level = 'critical';
    else if (/(warn|degraded|stale|drift)/.test(notes)) level = 'warn';
    res.json({ level, notes: state.notes || '', quiet: !!state.lastQuietBeat });
  } catch (err) {
    log.warn({ err }, 'health read failed');
    res.json({ level: 'warn', notes: 'heartbeat state unavailable', quiet: false });
  }
}

// ── Agent workbench tasks ────────────────────────────────────────────
export interface AgentTask {
  agentId: string;
  name: string;
  activity: string;
  mood: string;
  detail: string;
  updatedAt: number;
}

type AgentLike = {
  id: string;
  name: string;
  activity?: string;
  mood?: string;
  lastActive?: number;
};

export function makeAgentTasks(getAgents: () => AgentLike[]) {
  return (_req: express.Request, res: express.Response) => {
    const tasks: AgentTask[] = getAgents().map((a) => ({
      agentId: a.id,
      name: a.name,
      activity: a.activity || 'idle',
      mood: a.mood || 'neutral',
      detail: formatActivityDetail(a.activity || 'idle', a.mood || 'neutral'),
      updatedAt: a.lastActive || Date.now(),
    }));
    res.json({ tasks });
  };
}

function formatActivityDetail(activity: string, mood: string): string {
  const verb =
    {
      thinking: 'thinking through',
      monitoring: 'watching',
      researching: 'digging into',
      scanning: 'scanning',
      coding: 'shipping',
      testing: 'poking at',
      idle: 'resting on',
      speaking: 'talking about',
    }[activity] || activity;
  return `${verb} — ${mood}`;
}

// ── Scryfall (MTG table) ─────────────────────────────────────────────
export async function scryfallSearch(req: express.Request, res: express.Response) {
  const q = String(req.query.q || '').slice(0, 200);
  if (!q) {
    res.status(400).json({ error: 'q required' });
    return;
  }
  try {
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=released`;
    const r = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Harbor/0.5 (+harbor)' },
    });
    if (!r.ok) {
      res.status(r.status).json({ error: `scryfall ${r.status}` });
      return;
    }
    const data = (await r.json()) as { data?: unknown[] };
    const cards = (data.data || []).slice(0, 12).map((c) => {
      const card = c as {
        id: string;
        name: string;
        type_line?: string;
        mana_cost?: string;
        image_uris?: { normal?: string; small?: string };
      };
      return {
        id: card.id,
        name: card.name,
        type: card.type_line || '',
        cost: card.mana_cost || '',
        image: card.image_uris?.small || card.image_uris?.normal || '',
      };
    });
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ cards });
  } catch (err) {
    log.warn({ err }, 'scryfall proxy failed');
    res.status(502).json({ error: 'scryfall unreachable' });
  }
}
