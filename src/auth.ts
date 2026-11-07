import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';
import { HttpError } from './errors.js';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const JWT_ALGORITHM = 'HS256';
const jwtSecret = new TextEncoder().encode(config.jwtSecret);

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');

  if (
    !Number.isInteger(n) ||
    n < 1_024 ||
    n > 1_048_576 ||
    !Number.isInteger(r) ||
    r < 1 ||
    r > 32 ||
    !Number.isInteger(p) ||
    p < 1 ||
    p > 16 ||
    salt.length === 0 ||
    expected.length === 0
  ) {
    return false;
  }

  const derived = await scryptAsync(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 128 * 1024 * 1024,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function createAccessToken(userId: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject(userId)
    .setIssuer(config.jwtIssuer)
    .setAudience(config.jwtAudience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + config.accessTokenTtlSeconds)
    .sign(jwtSecret);
}

export async function verifyAccessToken(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret, {
      algorithms: [JWT_ALGORITHM],
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
      clockTolerance: 5,
    });
    if (!payload.sub) {
      throw new Error('Token sin subject');
    }
    return payload.sub;
  } catch {
    throw new HttpError(401, 'INVALID_TOKEN', 'Token inválido o expirado');
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface RefreshTokenValue {
  token: string;
  hash: string;
  expiresAt: Date;
}

export function createRefreshToken(): RefreshTokenValue {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000),
  };
}

export const authRequired: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Falta el token de acceso');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Falta el token de acceso');
    }
    req.userId = await verifyAccessToken(token);
    next();
  } catch (error) {
    next(error);
  }
};

export function currentUserId(req: Request): string {
  if (!req.userId) {
    throw new HttpError(401, 'UNAUTHORIZED', 'No autenticado');
  }
  return req.userId;
}
