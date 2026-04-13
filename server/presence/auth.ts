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
 */
export function verifyToken(token: string): { userId: string; role: string } {
  const payload = jwt.verify(token, getJwtSecret()) as {
    userId: string;
    role: string;
    type?: string;
  };
  if (payload.type === 'capability') {
    throw new Error('Capability token used where user token is required');
  }
  return { userId: payload.userId, role: payload.role };
}

/**
 * Login with username/password, return JWT.
 */
export async function loginUser(username: string, password: string): Promise<string> {
  const user = getUser(username);
  if (!user) throw new Error('Invalid credentials');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new Error('Invalid credentials');

  const token = jwt.sign({ userId: user.id, role: user.role, type: 'user' }, getJwtSecret(), {
    expiresIn: '24h',
  });

  log.info({ username, role: user.role }, 'User logged in');
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
 */
export function verifyCapabilityToken(token: string): {
  agentId: string;
  capabilities: string[];
} {
  const payload = jwt.verify(token, getJwtSecret()) as {
    agentId: string;
    capabilities: string[];
    type: string;
  };
  if (payload.type !== 'capability') {
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
