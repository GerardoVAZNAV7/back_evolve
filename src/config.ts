import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isProduction = process.env.NODE_ENV === 'production';
const rootDir = fileURLToPath(new URL('..', import.meta.url));

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`La variable ${name} debe estar entre ${min} y ${max}`);
  }
  return value;
}

const databaseUrl = requireEnv(
  'DATABASE_URL',
  isProduction ? undefined : 'postgresql://postgres:postgres@localhost:5432/evolve'
);

const jwtSecret = requireEnv(
  'JWT_SECRET',
  isProduction ? undefined : 'dev-secret-change-me-please-32-bytes'
);

if (isProduction && jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
}

export const config = {
  isProduction,
  port: numberEnv('PORT', 3000, 1, 65535),
  databaseUrl,
  databasePoolMax: numberEnv('DATABASE_POOL_MAX', 5, 1, 50),
  jwtSecret,
  jwtIssuer: process.env.JWT_ISSUER ?? 'evolve-api',
  jwtAudience: process.env.JWT_AUDIENCE ?? 'evolve-app',
  accessTokenTtlSeconds: numberEnv('ACCESS_TOKEN_TTL_SECONDS', 900, 60, 86_400),
  refreshTokenTtlDays: numberEnv('REFRESH_TOKEN_TTL_DAYS', 30, 1, 365),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  mediaBaseUrl: (process.env.MEDIA_BASE_URL ?? '').replace(/\/+$/, ''),
  rootDir,
  dataFile: path.join(rootDir, 'data', 'exercises.json'),
  publicDir: path.join(rootDir, 'public'),
  sqlDir: path.join(rootDir, 'sql'),
};
