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
import type { EventType } from './types.js';
import { DEFAULT_AGENTS } from './types.js';

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
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; frame-ancestors 'none'",
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
  const proxyReq = http.request(
    proxyUrl,
    { method: req.method, headers: { ...req.headers, host: new URL(MEDIA_SERVICE_URL).host } },
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
  req.pipe(proxyReq);
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

function handleAgentAction(eventType: EventType, capability: string) {
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
        data: sanitized,
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

app.post('/harbor/move', ...handleAgentAction('agent:move', 'move'));
app.post('/harbor/speak', ...handleAgentAction('agent:speak', 'speak'));
app.post('/harbor/gesture', ...handleAgentAction('agent:gesture', 'gesture'));
app.post('/harbor/status', ...handleAgentAction('agent:status', 'status'));

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

        // Handle user chat
        if (msg.type === 'chat' && typeof msg.text === 'string') {
          // Sanitize chat text: strip HTML, limit length
          const sanitizedText = sanitizeText(msg.text, 2000);
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
