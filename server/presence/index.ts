import express from 'express';
import http from 'node:http';
import path from 'node:path';
import url from 'node:url';
import { WebSocketServer } from 'ws';
import pino from 'pino';

import { initDb, closeDb } from './db.js';
import {
  initAuth,
  loginUser,
  verifyToken,
  requireAuth,
  requireAdmin,
  requireCapability,
  getLoginDelay,
  getFailedLoginState,
  recordFailedLogin,
} from './auth.js';
import type { AuthRequest } from './auth.js';
import { StateEngine } from './state.js';
import { PolicyEngine } from './policy.js';
import { BroadcastManager } from './broadcast.js';
import { BehaviorEngine } from './behavior.js';
import { generateAgentToken, generateAllAgentTokens, listAgentProfiles } from './capabilities.js';
import {
  cameraProxy,
  journalEntries,
  systemHealth,
  makeAgentTasks,
  scryfallSearch,
} from './panels.js';
import type { EventType, Position, SequenceStep, Signal } from './types.js';
import { DEFAULT_AGENTS, DEFAULT_ZONES } from './types.js';
import { resolveSignal, knownSignalTypes } from './signals.js';

const log = pino({ name: 'harbor' });
const PORT = parseInt(process.env.HARBOR_PORT || '3333', 10);
const startTime = Date.now();

// --- Allowed origins for CSRF / WebSocket origin checks ---

const ALLOWED_ORIGINS: Set<string> = new Set();
if (process.env.HARBOR_ALLOWED_ORIGINS) {
  for (const origin of process.env.HARBOR_ALLOWED_ORIGINS.split(',')) {
    ALLOWED_ORIGINS.add(origin.trim().toLowerCase());
  }
}

function isOriginAllowed(origin: string | undefined, requestHost: string | undefined): boolean {
  // No origin header = same-origin request (non-browser or same-origin fetch)
  if (!origin) return true;

  const normalizedOrigin = origin.toLowerCase();

  // Check against explicit allow list
  if (ALLOWED_ORIGINS.has(normalizedOrigin)) return true;

  // Allow same-origin: compare origin host with request Host header
  try {
    const originUrl = new URL(normalizedOrigin);
    if (requestHost && originUrl.host === requestHost) return true;
  } catch {
    // Malformed origin — reject
    return false;
  }

  return false;
}

// --- Rate limiter for login endpoint ---

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const loginRateLimit = new Map<string, RateLimitEntry>();
const LOGIN_RATE_WINDOW = 60 * 1000; // 1 minute
const LOGIN_RATE_MAX = 5; // max attempts per window

// Clean up stale rate limit entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of loginRateLimit) {
      if (now - entry.windowStart > LOGIN_RATE_WINDOW * 2) {
        loginRateLimit.delete(ip);
      }
    }
  },
  5 * 60 * 1000,
).unref();

function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = loginRateLimit.get(ip);

  if (!entry || now - entry.windowStart > LOGIN_RATE_WINDOW) {
    loginRateLimit.set(ip, { count: 1, windowStart: now });
    return { allowed: true };
  }

  entry.count++;
  if (entry.count > LOGIN_RATE_MAX) {
    const retryAfter = Math.ceil((entry.windowStart + LOGIN_RATE_WINDOW - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

// --- Input sanitization helpers ---

/**
 * Strip HTML tags and limit string length.
 */
function sanitizeText(input: string, maxLength: number = 2000): string {
  const stripped = input.replace(/<[^>]*>/g, '');
  return stripped.trim().slice(0, maxLength);
}

/**
 * Validate and sanitize agent event data.
 * Rejects oversized payloads (>10KB serialized) and strips dangerous keys.
 */
function sanitizeAgentData(data: Record<string, unknown>): {
  valid: boolean;
  sanitized: Record<string, unknown>;
  reason?: string;
} {
  const serialized = JSON.stringify(data);
  if (serialized.length > 10240) {
    return { valid: false, sanitized: {}, reason: 'Payload too large (max 10KB)' };
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (typeof value === 'string') {
      sanitized[key] = sanitizeText(value, 2000);
    } else {
      sanitized[key] = value;
    }
  }

  return { valid: true, sanitized };
}

// --- Circuit breaker for media service proxy ---

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
// Upstream must respond within this window or we treat it as a failure. Without
// a timeout, a slow-loris / half-open socket hangs the proxy forever — the
// response callback never fires, errors never fire, and the circuit breaker
// can't see anything wrong. 15s covers Fish Audio TTS generation comfortably.
const MEDIA_PROXY_TIMEOUT_MS = 15_000;

let mediaErrorCount = 0;
let circuitOpenUntil = 0;

type MediaServiceStatus = 'up' | 'degraded' | 'down';

function getMediaServiceStatus(): MediaServiceStatus {
  if (Date.now() < circuitOpenUntil) return 'down';
  if (mediaErrorCount > 0) return 'degraded';
  return 'up';
}

function recordMediaError(): void {
  mediaErrorCount++;
  if (mediaErrorCount >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    log.warn(
      { errorCount: mediaErrorCount, cooldownMs: CIRCUIT_BREAKER_COOLDOWN_MS },
      'Media service circuit breaker OPEN — stopping proxy for cooldown period',
    );
  }
}

function recordMediaSuccess(): void {
  mediaErrorCount = 0;
  circuitOpenUntil = 0;
}

// --- Uncaught exception / rejection handlers ---

process.on('uncaughtException', (err) => {
  log.error({ err }, 'Uncaught exception — process continuing');
});

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled rejection — process continuing');
});

// --- Initialize core systems ---

const db = initDb();
await initAuth(db);

const stateEngine = new StateEngine();
const policyEngine = new PolicyEngine();
const broadcastManager = new BroadcastManager();
const behaviorEngine = new BehaviorEngine(DEFAULT_AGENTS);

// Wire behavior engine reactions → state engine → broadcast
behaviorEngine.setReactionCallback((reactions) => {
  for (const reaction of reactions) {
    try {
      const eventType: EventType =
        reaction.type === 'move'
          ? 'agent:move'
          : reaction.type === 'gesture'
            ? 'agent:react'
            : 'agent:status';

      const event = stateEngine.applyEvent({
        timestamp: Date.now(),
        type: eventType,
        agentId: reaction.agentId,
        data: reaction.data,
      });
      broadcastManager.broadcastEvent(event);
    } catch (err) {
      log.error({ err, reaction }, 'Behavior engine reaction callback failed');
    }
  }
});

// Wrap behavior engine start with safety
try {
  behaviorEngine.start();
} catch (err) {
  log.error({ err }, 'Behavior engine failed to start — continuing without behaviors');
}

// --- Express app ---

const app = express();

// --- Security headers middleware (helmet-style, no dependency) ---

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' blob: https://static.cloudflareinsights.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://cards.scryfall.io https://c1.scryfall.com; connect-src 'self' blob: ws: wss: https://cdn.jsdelivr.net https://cloudflareinsights.com; font-src 'self' data: https://cdn.jsdelivr.net; object-src 'none'; frame-ancestors 'none'",
  );
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  next();
});

// --- CSRF protection middleware for state-changing methods ---

app.use((req, res, next) => {
  // Only check state-changing methods
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return next();
  }

  // Skip CSRF for capability-token (agent) requests — they're server-to-server
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const parts = authHeader.slice(7).split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
        if (payload.type === 'capability') {
          return next();
        }
      }
    } catch {
      // Not a valid JWT structure — continue with CSRF check
    }
  }

  const origin = req.headers.origin as string | undefined;
  const host = req.headers.host;

  if (!isOriginAllowed(origin, host)) {
    log.warn({ origin, host, path: req.path, method: req.method }, 'CSRF: origin rejected');
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  next();
});

app.use(express.json({ limit: '16kb' }));

// Serve static client files
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../../client/dist');
app.use(express.static(clientDist));

// Serve VRM avatar files from server/public/avatars
const avatarDir = path.resolve(__dirname, '../../public/avatars');
app.use(
  '/avatars',
  express.static(avatarDir, {
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  }),
);

// Serve VRMA animation clips from server/public/animations
const animationsDir = path.resolve(__dirname, '../../public/animations');
app.use(
  '/animations',
  express.static(animationsDir, {
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  }),
);

// Proxy /media requests to Media Service (port 3334) in production
const MEDIA_SERVICE_URL = process.env.HARBOR_MEDIA_URL || 'http://localhost:3334';
app.use('/media', (req, res) => {
  // Circuit breaker check
  if (Date.now() < circuitOpenUntil) {
    const retryAfter = Math.ceil((circuitOpenUntil - Date.now()) / 1000);
    res.status(503).json({
      error: 'Media service temporarily unavailable (circuit breaker open)',
      retryAfterSeconds: retryAfter,
    });
    return;
  }

  const proxyUrl = `${MEDIA_SERVICE_URL}${req.originalUrl}`;

  // express.json() earlier in the chain drains the request stream, so we
  // can't `req.pipe(proxyReq)` — the body bytes are already gone. Re-serialize
  // the parsed body (when present) and fix Content-Length to match. Without
  // this, upstream waits forever for a body that never arrives → hang.
  const hasParsedBody =
    req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0;
  let bodyBuffer: Buffer | null = null;
  const forwardedHeaders: Record<string, string | string[] | undefined> = {
    ...req.headers,
    host: new URL(MEDIA_SERVICE_URL).host,
  };
  if (hasParsedBody) {
    bodyBuffer = Buffer.from(JSON.stringify(req.body));
    forwardedHeaders['content-length'] = String(bodyBuffer.length);
    forwardedHeaders['content-type'] = 'application/json';
    delete forwardedHeaders['transfer-encoding'];
  }

  const proxyReq = http.request(
    proxyUrl,
    { method: req.method, headers: forwardedHeaders, timeout: MEDIA_PROXY_TIMEOUT_MS },
    (proxyRes) => {
      recordMediaSuccess();
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', (err) => {
    recordMediaError();
    log.warn({ err, url: proxyUrl, errorCount: mediaErrorCount }, 'Media service proxy error');
    if (!res.headersSent) res.status(502).json({ error: 'Media service unavailable' });
  });
  proxyReq.on('timeout', () => {
    recordMediaError();
    log.warn(
      { url: proxyUrl, timeoutMs: MEDIA_PROXY_TIMEOUT_MS, errorCount: mediaErrorCount },
      'Media service proxy timeout — destroying socket',
    );
    proxyReq.destroy(new Error('Media service timeout'));
    if (!res.headersSent) res.status(504).json({ error: 'Media service timeout' });
  });

  if (bodyBuffer) {
    proxyReq.end(bodyBuffer);
  } else {
    req.pipe(proxyReq);
  }
});

// --- Public endpoints ---

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    agents: Object.keys(stateEngine.getState().agents).length,
    sequence: stateEngine.getState().sequence,
    clients: broadcastManager.clientCount,
    mediaService: getMediaServiceStatus(),
  });
});

app.post('/api/auth/login', async (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' });
    return;
  }

  // Rate limit check (max 5 attempts per minute per IP)
  const rateCheck = checkLoginRateLimit(clientIp);
  if (!rateCheck.allowed) {
    log.warn({ ip: clientIp, username }, 'Login rate limited');
    res.status(429).json({
      error: 'Too many login attempts. Try again later.',
      retryAfter: rateCheck.retryAfter,
    });
    return;
  }

  // Exponential backoff delay for repeated failures
  const delay = getLoginDelay(clientIp);
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  try {
    const token = await loginUser(username, password, clientIp);
    res.json({ token });
  } catch (err) {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// --- Authenticated user endpoints ---

app.get('/api/state', requireAuth, (_req, res) => {
  res.json(stateEngine.getState());
});

app.get('/api/agents', requireAuth, (_req, res) => {
  res.json(stateEngine.getAgentRoster());
});

// --- Agent action endpoints (capability-scoped) ---

/**
 * Resolve a symbolic move target ({to: "<zoneId|agentId>"}) to a concrete
 * position + zone. If no `to` field, pass data through unchanged.
 * Zone targets land on a polar slot around the center so multiple agents
 * arriving at the same zone don't stack. Agent targets stand 1u in front of
 * the target agent on a side that isn't already occupied.
 */
function resolveMoveTarget(
  data: Record<string, unknown>,
  movingAgentId?: string,
): Record<string, unknown> {
  const to = data.to;
  if (typeof to !== 'string' || !to) return data;

  const state = stateEngine.getState();

  const MIN_AGENT_SPACING = 0.9; // rough avatar diameter + breathing room

  const isFar = (p: Position, q: Position): boolean => {
    const dx = p.x - q.x;
    const dz = p.z - q.z;
    return dx * dx + dz * dz >= MIN_AGENT_SPACING * MIN_AGENT_SPACING;
  };

  // Agent ID → stand near that agent, on a side that's still free
  const targetAgent = state.agents[to];
  if (targetAgent) {
    const pos = targetAgent.position;
    const others = Object.values(state.agents).filter(
      (a) => a.id !== targetAgent.id && a.id !== movingAgentId,
    );
    const offsets: Array<[number, number]> = [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
      [1.4, 0],
      [-1.4, 0],
      [0, 1.4],
      [0, -1.4],
    ];
    let picked = offsets[0];
    for (const off of offsets) {
      const candidate = { x: pos.x + off[0], y: pos.y, z: pos.z + off[1] };
      if (others.every((a) => isFar(a.position, candidate))) {
        picked = off;
        break;
      }
    }
    const { to: _drop, ...rest } = data;
    void _drop;
    return {
      ...rest,
      position: { x: pos.x + picked[0], y: pos.y, z: pos.z + picked[1] } as Position,
      zone: targetAgent.zone,
    };
  }

  // Zone ID → polar slot around the zone center.
  // How many agents are already in (or heading to) the zone? That count drives
  // the angular slot so agents fan out instead of piling up at the center.
  const zone = DEFAULT_ZONES.find((z) => z.id === to);
  if (zone) {
    const radius = zone.radius ?? 1;
    const slotRadius = Math.max(0.6, radius * 0.7);

    const occupants = Object.values(state.agents).filter(
      (a) => a.id !== movingAgentId && a.zone === zone.id,
    );

    // Deterministic base angle from the moving agent's id so the same agent
    // prefers the same side of a zone across visits (readable motion).
    const hashSeed = movingAgentId
      ? [...movingAgentId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0)
      : Math.floor(Math.random() * 1000);
    const baseAngle = (hashSeed % 360) * (Math.PI / 180);

    // Try 8 slots around the ring, starting at baseAngle; pick the first that's
    // far from existing occupants.
    let picked: Position = {
      x: zone.center.x + Math.cos(baseAngle) * slotRadius,
      y: zone.center.y,
      z: zone.center.z + Math.sin(baseAngle) * slotRadius,
    };
    for (let i = 0; i < 8; i++) {
      const a = baseAngle + (i * Math.PI * 2) / 8;
      const candidate: Position = {
        x: zone.center.x + Math.cos(a) * slotRadius,
        y: zone.center.y,
        z: zone.center.z + Math.sin(a) * slotRadius,
      };
      if (occupants.every((o) => isFar(o.position, candidate))) {
        picked = candidate;
        break;
      }
    }

    const { to: _drop, ...rest } = data;
    void _drop;
    return {
      ...rest,
      position: picked,
      zone: zone.id,
    };
  }

  // Unknown target — let it fall through as a no-op (position unchanged)
  const { to: _drop, ...rest } = data;
  void _drop;
  return rest;
}

function handleAgentAction(
  eventType: EventType,
  capability: string,
  transform?: (data: Record<string, unknown>, movingAgentId?: string) => Record<string, unknown>,
) {
  return [
    requireCapability(capability),
    (req: AuthRequest, res: express.Response) => {
      const agentId = req.agentId!;
      const rawData = req.body || {};

      // Sanitize agent event data
      const { valid, sanitized, reason } = sanitizeAgentData(rawData);
      if (!valid) {
        res.status(400).json({ error: reason });
        return;
      }

      // Optional post-sanitize transform (e.g. resolve move targets)
      const processed = transform ? transform(sanitized, agentId) : sanitized;

      // Policy check
      const policy = policyEngine.evaluate(agentId, capability);
      if (!policy.approved) {
        res.status(429).json({ error: policy.reason });
        return;
      }

      // Apply event
      const event = stateEngine.applyEvent({
        timestamp: Date.now(),
        type: eventType,
        agentId,
        data: processed,
      });

      // Feed to behavior engine for reactive behaviors
      try {
        behaviorEngine.processEvent(event, stateEngine.getState().agents);
      } catch (err) {
        log.error({ err, eventType, agentId }, 'Behavior engine tick failed — skipping');
      }

      // Broadcast to connected clients
      broadcastManager.broadcastEvent(event);

      res.json({ ok: true, sequence: event.sequence });
    },
  ] as express.RequestHandler[];
}

app.post('/harbor/move', ...handleAgentAction('agent:move', 'move', resolveMoveTarget));
app.post('/harbor/speak', ...handleAgentAction('agent:speak', 'speak'));
app.post('/harbor/gesture', ...handleAgentAction('agent:gesture', 'gesture'));
app.post('/harbor/status', ...handleAgentAction('agent:status', 'status'));

// --- Multi-step sequence endpoint ---

const SEQUENCE_MAX_STEPS = 16;
const SEQUENCE_WALK_SPEED = 2.0;
const SEQUENCE_MIN_WALK_DISTANCE = 0.5;
const SEQUENCE_SPEAK_MS = 4500;
const SEQUENCE_GESTURE_MS = 3000;

function distance2D(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

async function runSequence(
  agentId: string,
  steps: SequenceStep[],
): Promise<{ ok: true; ran: number } | { ok: false; error: string; ranSoFar: number }> {
  let ran = 0;
  for (const step of steps) {
    try {
      switch (step.type) {
        case 'move': {
          const policy = policyEngine.evaluate(agentId, 'move');
          if (!policy.approved)
            return { ok: false, error: policy.reason || 'move blocked', ranSoFar: ran };

          const resolved = resolveMoveTarget(
            {
              ...(step.position ? { position: step.position } : {}),
              ...(step.to ? { to: step.to } : {}),
              ...(step.zone ? { zone: step.zone } : {}),
              ...(step.rotation !== undefined ? { rotation: step.rotation } : {}),
              ...(step.animation ? { animation: step.animation } : {}),
            },
            agentId,
          );

          // Snapshot position BEFORE applyEvent — getAgentState returns a
          // live reference that applyEvent mutates in place.
          const beforeRef = stateEngine.getAgentState(agentId);
          const beforePos: Position | null = beforeRef
            ? { x: beforeRef.position.x, y: beforeRef.position.y, z: beforeRef.position.z }
            : null;

          const event = stateEngine.applyEvent({
            timestamp: Date.now(),
            type: 'agent:move',
            agentId,
            data: resolved,
          });
          broadcastManager.broadcastEvent(event);

          const target = resolved.position as Position | undefined;
          if (beforePos && target) {
            const dist = distance2D(beforePos, target);
            if (dist >= SEQUENCE_MIN_WALK_DISTANCE) {
              const waitMs = Math.max(400, (dist / SEQUENCE_WALK_SPEED) * 1000);
              await new Promise((r) => setTimeout(r, waitMs));
            }
          }
          break;
        }
        case 'speak': {
          if (!step.text) return { ok: false, error: 'speak requires text', ranSoFar: ran };
          const policy = policyEngine.evaluate(agentId, 'speak');
          if (!policy.approved)
            return { ok: false, error: policy.reason || 'speak blocked', ranSoFar: ran };

          const text = sanitizeText(step.text, 2000);
          const event = stateEngine.applyEvent({
            timestamp: Date.now(),
            type: 'agent:speak',
            agentId,
            data: { text },
          });
          broadcastManager.broadcastEvent(event);
          policyEngine.recordSuccess(agentId);
          await new Promise((r) => setTimeout(r, SEQUENCE_SPEAK_MS));
          break;
        }
        case 'gesture': {
          if (!step.animation)
            return { ok: false, error: 'gesture requires animation', ranSoFar: ran };
          const policy = policyEngine.evaluate(agentId, 'gesture');
          if (!policy.approved)
            return { ok: false, error: policy.reason || 'gesture blocked', ranSoFar: ran };

          const duration = step.duration || SEQUENCE_GESTURE_MS;
          const event = stateEngine.applyEvent({
            timestamp: Date.now(),
            type: 'agent:gesture',
            agentId,
            data: { animation: step.animation, duration },
          });
          broadcastManager.broadcastEvent(event);
          await new Promise((r) => setTimeout(r, duration));
          break;
        }
        case 'status': {
          const policy = policyEngine.evaluate(agentId, 'status');
          if (!policy.approved)
            return { ok: false, error: policy.reason || 'status blocked', ranSoFar: ran };

          const data: Record<string, unknown> = {};
          if (step.activity) data.activity = step.activity;
          if (step.mood) data.mood = step.mood;
          if (step.animation) data.animation = step.animation;
          const event = stateEngine.applyEvent({
            timestamp: Date.now(),
            type: 'agent:status',
            agentId,
            data,
          });
          broadcastManager.broadcastEvent(event);
          break;
        }
        case 'wait': {
          const ms = Math.max(0, Math.min(10_000, step.ms || 0));
          await new Promise((r) => setTimeout(r, ms));
          break;
        }
        default:
          return {
            ok: false,
            error: `unknown step type: ${(step as { type: string }).type}`,
            ranSoFar: ran,
          };
      }
      ran++;
    } catch (err) {
      log.error({ err, agentId, step }, 'Sequence step failed');
      return { ok: false, error: 'step execution failed', ranSoFar: ran };
    }
  }
  return { ok: true, ran };
}

app.post('/harbor/sequence', requireCapability('move'), async (req: AuthRequest, res) => {
  const agentId = req.agentId!;
  const steps = req.body?.steps as SequenceStep[] | undefined;

  if (!Array.isArray(steps) || steps.length === 0) {
    res.status(400).json({ error: 'steps array required' });
    return;
  }
  if (steps.length > SEQUENCE_MAX_STEPS) {
    res.status(400).json({ error: `max ${SEQUENCE_MAX_STEPS} steps` });
    return;
  }

  const result = await runSequence(agentId, steps);
  if (result.ok) {
    res.json({ ok: true, ran: result.ran });
  } else {
    res.status(400).json({ error: result.error, ranSoFar: result.ranSoFar });
  }
});

// --- Pre-baked demo scenarios (admin-auth) ---

const DEMO_SCENARIOS: Record<string, { agentId: string; steps: SequenceStep[] }> = {
  'nygma-present': {
    agentId: 'nygma',
    steps: [
      { type: 'status', activity: 'thinking', mood: 'curious' },
      { type: 'wait', ms: 600 },
      { type: 'move', to: 'meeting-room' },
      { type: 'status', activity: 'presenting', mood: 'focused' },
      { type: 'gesture', animation: 'wave', duration: 2500 },
      { type: 'speak', text: 'Riddle me this — what walks, waves, and waits to be heard?' },
      { type: 'status', activity: 'idle', mood: 'playful' },
    ],
  },
  'margot-greet': {
    agentId: 'margot',
    steps: [
      { type: 'move', to: 'user-corner' },
      { type: 'gesture', animation: 'wave', duration: 2000 },
      { type: 'speak', text: "Heya Puddin'! Margot on deck." },
      { type: 'move', to: 'margot-desk' },
      { type: 'status', activity: 'working', mood: 'playful' },
    ],
  },
  'lounge-party': {
    agentId: 'lou',
    steps: [
      { type: 'move', to: 'lounge' },
      { type: 'gesture', animation: 'wave', duration: 2000 },
      { type: 'speak', text: "Yo, lounge check — who's hangin'?" },
    ],
  },
};

app.post('/harbor/demo/:scenario', requireAdmin, async (req, res) => {
  const name = String(req.params.scenario ?? '');
  const scenario = DEMO_SCENARIOS[name];
  if (!scenario) {
    res.status(404).json({ error: 'unknown scenario', available: Object.keys(DEMO_SCENARIOS) });
    return;
  }

  const result = await runSequence(scenario.agentId, scenario.steps);
  if (result.ok) {
    res.json({ ok: true, scenario: name, agentId: scenario.agentId, ran: result.ran });
  } else {
    res.status(500).json({ error: result.error, ranSoFar: result.ranSoFar });
  }
});

// --- Signal bus (admin-auth) ---
// Inbound external/internal signals → resolved against the catalog → run as
// a sequence for the reacting agent. Cooldown keyed on `${agentId}:${type}`
// to prevent spam from flappy upstream systems (CI retries, chat echoes).

const signalCooldowns = new Map<string, number>();
const SIGNAL_DEFAULT_COOLDOWN_MS = 10_000;

app.post('/harbor/signal', requireAdmin, async (req, res) => {
  const body = req.body as Partial<Signal> | undefined;
  const source = typeof body?.source === 'string' ? body.source : '';
  const type = typeof body?.type === 'string' ? body.type : '';

  if (!source || !type) {
    res.status(400).json({ error: 'signal requires source + type' });
    return;
  }

  const signal: Signal = {
    source,
    type,
    data: (body?.data as Record<string, unknown>) || {},
    timestamp: Date.now(),
  };

  const agents = stateEngine.getState().agents;
  const reaction = resolveSignal(signal, agents);

  if (!reaction) {
    res.status(200).json({ ok: true, matched: false, reason: 'no catalog entry or agent missing' });
    return;
  }

  const cooldownKey = `${reaction.agentId}:${signal.type}`;
  const last = signalCooldowns.get(cooldownKey) ?? 0;
  const cd = reaction.cooldownMs ?? SIGNAL_DEFAULT_COOLDOWN_MS;
  const since = Date.now() - last;
  if (since < cd) {
    res.status(200).json({ ok: true, matched: true, cooled: true, waitMs: cd - since });
    return;
  }
  signalCooldowns.set(cooldownKey, Date.now());

  // Run the sequence — don't block the HTTP response on the full walk/speak
  // duration. Log failure but return 202 immediately so callers (webhooks)
  // don't hang.
  runSequence(reaction.agentId, reaction.steps)
    .then((result) => {
      if (!result.ok) {
        log.warn({ signal, agentId: reaction.agentId, result }, 'Signal sequence failed');
      }
    })
    .catch((err) => {
      log.error({ err, signal, agentId: reaction.agentId }, 'Signal sequence threw');
    });

  res.status(202).json({
    ok: true,
    matched: true,
    agentId: reaction.agentId,
    steps: reaction.steps.length,
  });
});

app.get('/harbor/signal/types', requireAdmin, (_req, res) => {
  res.json({ types: knownSignalTypes() });
});

app.get('/harbor/state', requireCapability('read'), (req: AuthRequest, res) => {
  const agentId = req.agentId!;
  const agent = stateEngine.getAgentState(agentId);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }
  res.json({
    self: agent,
    world: stateEngine.getState(),
  });
});

// --- Admin endpoints (requires user auth) ---

app.get('/api/capabilities', requireAdmin, (_req, res) => {
  res.json(listAgentProfiles());
});

app.post('/api/capabilities/token', requireAdmin, (req, res) => {
  const { agentId } = req.body;
  if (!agentId) {
    res.status(400).json({ error: 'agentId required' });
    return;
  }
  const token = generateAgentToken(agentId);
  res.json({ agentId, token });
});

app.post('/api/capabilities/tokens/all', requireAdmin, (_req, res) => {
  const tokens = generateAllAgentTokens();
  res.json(tokens);
});

app.get('/api/behavior', requireAuth, (_req, res) => {
  const roster = stateEngine.getAgentRoster();
  const behaviors: Record<string, unknown> = {};
  for (const agent of roster) {
    behaviors[agent.id] = {
      ...behaviorEngine.getBehavior(agent.id),
      talkBudget: policyEngine.getTalkBudgetStatus(agent.id),
    };
  }
  res.json(behaviors);
});

// --- Inter-agent conversation endpoint ---

app.post(
  '/harbor/conversation',
  requireCapability('speak'),
  (req: AuthRequest, res: express.Response) => {
    const fromAgent = req.agentId!;
    const { toAgent, text } = req.body;

    if (!toAgent || !text) {
      res.status(400).json({ error: 'toAgent and text required' });
      return;
    }

    // Sanitize conversation text
    const sanitizedText = sanitizeText(text, 2000);
    if (!sanitizedText) {
      res.status(400).json({ error: 'text must not be empty after sanitization' });
      return;
    }

    // Policy check for sender
    const policy = policyEngine.evaluate(fromAgent, 'speak');
    if (!policy.approved) {
      res.status(429).json({ error: policy.reason });
      return;
    }

    const event = stateEngine.applyEvent({
      timestamp: Date.now(),
      type: 'agent:conversation',
      agentId: fromAgent,
      data: { fromAgent, toAgent, text: sanitizedText },
    });

    try {
      behaviorEngine.processEvent(event, stateEngine.getState().agents);
    } catch (err) {
      log.error(
        { err, fromAgent, toAgent },
        'Behavior engine tick failed during conversation — skipping',
      );
    }

    broadcastManager.broadcastEvent(event);

    policyEngine.recordSuccess(fromAgent);
    res.json({ ok: true, sequence: event.sequence });
  },
);

// --- Phase 5 panel routes ---

app.get('/api/panel/camera', requireAuth, cameraProxy);
app.get('/api/panel/journal', requireAuth, journalEntries);
app.get('/api/panel/health', requireAuth, systemHealth);
app.get(
  '/api/panel/tasks',
  requireAuth,
  makeAgentTasks(() => stateEngine.getAgentRoster()),
);
app.get('/api/panel/scryfall', requireAuth, scryfallSearch);

// SPA fallback — serve index.html for unmatched routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) {
      res.status(404).json({ error: 'Not found' });
    }
  });
});

// --- HTTP server + WebSocket ---

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  // --- WebSocket origin validation ---
  const wsOrigin = (request.headers.origin || request.headers['sec-websocket-origin']) as
    | string
    | undefined;
  const wsHost = request.headers.host;

  if (!isOriginAllowed(wsOrigin, wsHost)) {
    log.warn({ origin: wsOrigin, host: wsHost }, 'WebSocket upgrade rejected — origin not allowed');
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  // Parse token from query string
  const parsedUrl = url.parse(request.url || '', true);
  const token = parsedUrl.query.token as string | undefined;

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    const { userId } = verifyToken(token);
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, userId);
    });
  } catch (err) {
    log.warn('WebSocket auth failed');
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});

wss.on(
  'connection',
  (ws: import('ws').WebSocket, _request: import('http').IncomingMessage, userId: string) => {
    broadcastManager.addClient(ws, userId);

    // Send full state on connect
    broadcastManager.sendFullState(ws, stateEngine.getState());

    // Emit user:join event
    const joinEvent = stateEngine.applyEvent({
      timestamp: Date.now(),
      type: 'user:join',
      userId,
      data: { userId },
    });
    try {
      behaviorEngine.processEvent(joinEvent, stateEngine.getState().agents);
    } catch (err) {
      log.error({ err, userId }, 'Behavior engine tick failed on user:join — skipping');
    }
    broadcastManager.broadcastEvent(joinEvent);

    ws.on('message', (raw: import('ws').RawData) => {
      try {
        const rawStr = raw.toString();

        // Reject oversized WebSocket messages (max 16KB)
        if (rawStr.length > 16384) {
          log.warn({ userId, size: rawStr.length }, 'WebSocket message too large — dropped');
          return;
        }

        const msg = JSON.parse(rawStr);

        // Handle catchup request — client sends { type: 'catchup', since: <sequence> }
        if (msg.type === 'catchup' && typeof msg.since === 'number') {
          const events = stateEngine.getEventsSince(msg.since);
          ws.send(JSON.stringify({ type: 'catchup', data: events }));
          return;
        }

        // Handle pong response from client
        if (msg.type === 'pong') {
          broadcastManager.recordPong(ws);
          return;
        }

        // Handle user chat — accept both {type:'chat',text} and {type:'user:chat',data:{text}}
        const chatText =
          (msg.type === 'chat' && typeof msg.text === 'string' && msg.text) ||
          (msg.type === 'user:chat' &&
            msg.data &&
            typeof msg.data.text === 'string' &&
            msg.data.text) ||
          null;
        if (chatText !== null) {
          const sanitizedText = sanitizeText(chatText, 2000);
          if (!sanitizedText) return; // Silently drop empty messages

          const chatEvent = stateEngine.applyEvent({
            timestamp: Date.now(),
            type: 'user:chat',
            userId,
            data: { text: sanitizedText, userId },
          });
          try {
            behaviorEngine.processEvent(chatEvent, stateEngine.getState().agents);
          } catch (err) {
            log.error({ err, userId }, 'Behavior engine tick failed on user:chat — skipping');
          }
          broadcastManager.broadcastEvent(chatEvent);
          return;
        }
      } catch (err) {
        log.warn({ err }, 'Invalid WebSocket message');
      }
    });

    ws.on('close', () => {
      broadcastManager.removeClient(ws);

      const leaveEvent = stateEngine.applyEvent({
        timestamp: Date.now(),
        type: 'user:leave',
        userId,
        data: { userId },
      });
      try {
        behaviorEngine.processEvent(leaveEvent, stateEngine.getState().agents);
      } catch (err) {
        log.error({ err, userId }, 'Behavior engine tick failed on user:leave — skipping');
      }
      broadcastManager.broadcastEvent(leaveEvent);
    });

    ws.on('error', (err: Error) => {
      log.error({ err, userId }, 'WebSocket error');
      broadcastManager.removeClient(ws);
    });
  },
);

// --- Start server ---

server.listen(PORT, () => {
  log.info(`Harbor Presence Service running on port ${PORT}`);
  log.info(`Health check: http://localhost:${PORT}/api/health`);
  log.info(`WebSocket: ws://localhost:${PORT}?token=<jwt>`);
});

// --- Graceful shutdown ---

const shutdown = () => {
  log.info('Shutting down...');
  behaviorEngine.stop();
  broadcastManager.stopHeartbeat();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
