import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'node:crypto';
import pino from 'pino';
import type { Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import { getUser, createUser } from './db.js';

const log = pino({ name: 'harbor:auth' });

let JWT_SECRET: string;

function getJwtSecret(): string {
  if (JWT_SECRET) return JWT_SECRET;
  JWT_SECRET = process.env.HARBOR_JWT_SECRET || crypto.randomBytes(32).toString('hex');
  if (!process.env.HARBOR_JWT_SECRET) {
    log.warn(
      'No HARBOR_JWT_SECRET set — generated ephemeral secret (tokens will not survive restarts)',
    );
  }
  return JWT_SECRET;
}

// --- Token revocation blocklist (in-memory with TTL) ---

interface BlocklistEntry {
  expiresAt: number; // timestamp when the token would naturally expire
}

const tokenBlocklist = new Map<string, BlocklistEntry>();

// Purge expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of tokenBlocklist) {
    if (now > entry.expiresAt) {
      tokenBlocklist.delete(token);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Revoke a token by adding it to the blocklist.
 * The entry auto-expires when the token's natural expiry passes.
 */
export function revokeToken(token: string, expiresInMs: number = 24 * 60 * 60 * 1000): void {
  tokenBlocklist.set(token, { expiresAt: Date.now() + expiresInMs });
  log.info('Token revoked');
}

/**
 * Check if a token has been revoked.
 */
export function isTokenRevoked(token: string): boolean {
  const entry = tokenBlocklist.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    tokenBlocklist.delete(token);
    return false;
  }
  return true;
}

// --- Failed login tracking ---

interface LoginAttempt {
  count: number;
  firstAttempt: number;
  lastAttempt: number;
}

const failedLogins = new Map<string, LoginAttempt>();

// Clean up stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, attempt] of failedLogins) {
    // Remove entries older than 15 minutes with no recent activity
    if (now - attempt.lastAttempt > 15 * 60 * 1000) {
      failedLogins.delete(ip);
    }
  }
}, 10 * 60 * 1000).unref();

/**
 * Record a failed login attempt for an IP address.
 */
export function recordFailedLogin(ip: string): void {
  const existing = failedLogins.get(ip);
  const now = Date.now();
  if (existing) {
    existing.count++;
    existing.lastAttempt = now;
  } else {
    failedLogins.set(ip, { count: 1, firstAttempt: now, lastAttempt: now });
  }
  const entry = failedLogins.get(ip)!;
  log.warn({ ip, attempts: entry.count }, 'Failed login attempt');
}

/**
 * Get the current failed login state for an IP.
 */
export function getFailedLoginState(ip: string): LoginAttempt | undefined {
  return failedLogins.get(ip);
}

/**
 * Clear failed login attempts for an IP (on successful login).
 */
export function clearFailedLogins(ip: string): void {
  failedLogins.delete(ip);
}

/**
 * Get the rate limit delay in ms for an IP based on failed attempts (exponential backoff).
 * Returns 0 if no delay needed.
 */
export function getLoginDelay(ip: string): number {
  const state = failedLogins.get(ip);
  if (!state || state.count < 3) return 0;
  // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
  const delay = Math.min(1000 * Math.pow(2, state.count - 3), 30000);
  return delay;
}

// --- Timing-safe comparison helper ---

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) {
    // Compare against self to maintain constant time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Extend Express Request to carry auth info
export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  agentId?: string;
  capabilities?: string[];
}

/**
 * Initialize auth — create default admin user if none exists.
 */
export async function initAuth(_db: Database.Database): Promise<void> {
  const existing = getUser('admin');
  if (existing) {
    log.info('Admin user exists');
    return;
  }

  const password = process.env.HARBOR_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
  const hash = await bcrypt.hash(password, 10);
  const id = uuidv4();

  createUser(id, 'admin', hash, 'admin');

  if (!process.env.HARBOR_ADMIN_PASSWORD) {
    log.info('==========================================================');
    log.info(`  Default admin password: ${password}`);
    log.info('  Set HARBOR_ADMIN_PASSWORD env var to use a fixed password');
    log.info('==========================================================');
  } else {
    log.info('Admin user created with provided HARBOR_ADMIN_PASSWORD');
  }
}

/**
 * Verify a user JWT and return payload.
 * Uses timing-safe comparison for token type check and checks revocation blocklist.
 */
export function verifyToken(token: string): { userId: string; role: string } {
  if (isTokenRevoked(token)) {
    throw new Error('Token has been revoked');
  }

  const payload = jwt.verify(token, getJwtSecret()) as {
    userId: string;
    role: string;
    type?: string;
  };
  if (payload.type && timingSafeEqual(payload.type, 'capability')) {
    throw new Error('Capability token used where user token is required');
  }
  return { userId: payload.userId, role: payload.role };
}

/**
 * Login with username/password, return JWT.
 * Logs failures with IP address context (IP passed by caller).
 */
export async function loginUser(
  username: string,
  password: string,
  ip?: string,
): Promise<string> {
  const user = getUser(username);
  if (!user) {
    if (ip) recordFailedLogin(ip);
    log.warn({ username, ip }, 'Login failed — unknown user');
    throw new Error('Invalid credentials');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    if (ip) recordFailedLogin(ip);
    log.warn({ username, ip }, 'Login failed — wrong password');
    throw new Error('Invalid credentials');
  }

  // Successful login — clear failed attempts
  if (ip) clearFailedLogins(ip);

  const token = jwt.sign({ userId: user.id, role: user.role, type: 'user' }, getJwtSecret(), {
    expiresIn: '24h',
  });

  log.info({ username, role: user.role, ip }, 'User logged in');
  return token;
}

/**
 * Create a capability token scoped to a specific agent and set of capabilities.
 */
export function createCapabilityToken(agentId: string, capabilities: string[]): string {
  return jwt.sign({ agentId, capabilities, type: 'capability' }, getJwtSecret(), {
    expiresIn: '7d',
  });
}

/**
 * Verify an agent capability token.
 * Uses timing-safe comparison for token type check and checks revocation blocklist.
 */
export function verifyCapabilityToken(token: string): {
  agentId: string;
  capabilities: string[];
} {
  if (isTokenRevoked(token)) {
    throw new Error('Token has been revoked');
  }

  const payload = jwt.verify(token, getJwtSecret()) as {
    agentId: string;
    capabilities: string[];
    type: string;
  };
  if (!timingSafeEqual(payload.type, 'capability')) {
    throw new Error('User token used where capability token is required');
  }
  return { agentId: payload.agentId, capabilities: payload.capabilities };
}

/**
 * Express middleware — requires valid user JWT in Authorization header.
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  try {
    const { userId, role } = verifyToken(header.slice(7));
    req.userId = userId;
    req.userRole = role;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Express middleware — requires an authenticated admin user.
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (req.userRole !== 'admin') {
      res.status(403).json({ error: 'Admin role required' });
      return;
    }
    next();
  });
}

/**
 * Express middleware — requires valid capability token with the given capability.
 */
export function requireCapability(cap: string) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    try {
      const { agentId, capabilities } = verifyCapabilityToken(header.slice(7));
      if (!capabilities.includes(cap) && !capabilities.includes('*')) {
        res.status(403).json({ error: `Missing capability: ${cap}` });
        return;
      }
      req.agentId = agentId;
      req.capabilities = capabilities;
      next();
    } catch (err) {
      res.status(401).json({ error: 'Invalid or expired capability token' });
    }
  };
}
