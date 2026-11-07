import { Router } from 'express';
import {
  createAccessToken,
  createRefreshToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../auth.js';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { HttpError } from '../errors.js';
import { authLimiter } from '../rateLimit.js';
import { loginSchema, logoutSchema, refreshSchema, registerSchema } from '../schemas.js';
import { publicUser, type UserRow } from '../users.js';

interface RefreshTokenRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

const router = Router();

const userColumns = `
  id, email, name, weight_kg, height_cm, goal, level, timezone, created_at
`;

async function issueTokens(userId: string) {
  const accessToken = await createAccessToken(userId);
  const refresh = createRefreshToken();
  await query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, refresh.hash, refresh.expiresAt]
  );
  return {
    accessToken,
    refreshToken: refresh.token,
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtlSeconds,
  };
}

router.post('/register', authLimiter, async (req, res) => {
  const body = registerSchema.parse(req.body);

  const passwordHash = await hashPassword(body.password);
  const result = await query<UserRow>(
    `INSERT INTO users (email, password_hash, name, timezone)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING
     RETURNING ${userColumns}`,
    [body.email, passwordHash, body.name, body.timezone ?? 'UTC']
  );

  const user = result.rows[0];
  if (!user) {
    throw new HttpError(409, 'EMAIL_TAKEN', 'Ese email ya está registrado');
  }

  const tokens = await issueTokens(user.id);
  res.status(201).json({ ...tokens, user: publicUser(user) });
});

router.post('/login', authLimiter, async (req, res) => {
  const body = loginSchema.parse(req.body);

  const result = await query<UserRow>(
    `SELECT ${userColumns}, password_hash FROM users WHERE email = $1`,
    [body.email]
  );
  const user = result.rows[0];
  if (!user?.password_hash) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos');
  }

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email o contraseña incorrectos');
  }

  await query('DELETE FROM refresh_tokens WHERE expires_at < now()');
  const tokens = await issueTokens(user.id);
  res.json({ ...tokens, user: publicUser(user) });
});

router.post('/refresh', authLimiter, async (req, res) => {
  const body = refreshSchema.parse(req.body);
  const tokenHash = hashToken(body.refreshToken);

  const tokens = await withTransaction(async (client) => {
    const result = await client.query<RefreshTokenRow>(
      `SELECT id, user_id, expires_at, revoked_at
       FROM refresh_tokens
       WHERE token_hash = $1
       FOR UPDATE`,
      [tokenHash]
    );
    const stored = result.rows[0];
    if (
      !stored ||
      stored.revoked_at !== null ||
      new Date(stored.expires_at).getTime() <= Date.now()
    ) {
      throw new HttpError(
        401,
        'INVALID_REFRESH_TOKEN',
        'Refresh token inválido, expirado o revocado'
      );
    }

    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [
      stored.id,
    ]);

    const next = createRefreshToken();
    await client.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [stored.user_id, next.hash, next.expiresAt]
    );

    return {
      userId: stored.user_id,
      refreshToken: next.token,
    };
  });

  const accessToken = await createAccessToken(tokens.userId);
  res.json({
    accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtlSeconds,
  });
});

router.post('/logout', authLimiter, async (req, res) => {
  const body = logoutSchema.parse(req.body);
  await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(body.refreshToken)]
  );
  res.status(204).end();
});

export const authRouter = router;
