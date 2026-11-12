import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import {
  authRequired,
  createAccessToken,
  createRefreshToken,
  currentUserId,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../auth.js';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { HttpError } from '../errors.js';
import { sendPasswordResetEmail } from '../mailer.js';
import { authLimiter, sessionLimiter } from '../rateLimit.js';
import {
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  uuidParamSchema,
} from '../schemas.js';
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

router.post('/refresh', sessionLimiter, async (req, res) => {
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

    // Reuso de un token ya rotado: se asume robo y se cierran todas las sesiones.
    if (stored && stored.revoked_at !== null) {
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [stored.user_id]
      );
      return null;
    }

    if (!stored || new Date(stored.expires_at).getTime() <= Date.now()) {
      throw new HttpError(
        401,
        'INVALID_REFRESH_TOKEN',
        'Refresh token inválido o expirado'
      );
    }

    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [
      stored.id,
    ]);
    await client.query(
      'DELETE FROM refresh_tokens WHERE user_id = $1 AND expires_at < now()',
      [stored.user_id]
    );

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

  if (!tokens) {
    throw new HttpError(
      401,
      'REFRESH_TOKEN_REUSED',
      'El token ya fue usado; por seguridad se cerraron todas las sesiones'
    );
  }

  const accessToken = await createAccessToken(tokens.userId);
  res.json({
    accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: 'Bearer',
    expiresIn: config.accessTokenTtlSeconds,
  });
});

router.post('/logout', sessionLimiter, async (req, res) => {
  const body = logoutSchema.parse(req.body);
  await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashToken(body.refreshToken)]
  );
  res.status(204).end();
});

const RESET_TOKEN_TTL_MINUTES = 30;

router.post('/forgot-password', authLimiter, async (req, res) => {
  const body = forgotPasswordSchema.parse(req.body);

  const result = await query<{ id: string; email: string }>(
    'SELECT id, email FROM users WHERE email = $1',
    [body.email]
  );
  const user = result.rows[0];

  // Siempre 202: no se revela si el email existe.
  let debugResetToken: string | undefined;

  if (user) {
    const token = randomBytes(32).toString('base64url');

    await withTransaction(async (client) => {
      await client.query(
        'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
        [user.id]
      );
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + make_interval(mins => $3))`,
        [user.id, hashToken(token), RESET_TOKEN_TTL_MINUTES]
      );
    });

    const resetUrl = `${config.passwordResetUrl}?token=${encodeURIComponent(token)}`;
    await sendPasswordResetEmail(user.email, resetUrl).catch((error) => {
      console.error('No se pudo enviar el email de recuperación:', error);
    });

    if (!config.isProduction) {
      debugResetToken = token;
    }
  }

  res.status(202).json({
    data: { sent: true },
    ...(debugResetToken ? { debugResetToken } : {}),
  });
});

router.post('/reset-password', authLimiter, async (req, res) => {
  const body = resetPasswordSchema.parse(req.body);
  const passwordHash = await hashPassword(body.password);

  await withTransaction(async (client) => {
    const result = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [hashToken(body.token)]
    );
    const reset = result.rows[0];
    if (!reset) {
      throw new HttpError(400, 'INVALID_RESET_TOKEN', 'El enlace es inválido o expiró');
    }

    await client.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
      passwordHash,
      reset.user_id,
    ]);
    await client.query(
      'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
      [reset.user_id]
    );
    await client.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [reset.user_id]
    );
  });

  res.status(204).end();
});

router.get('/sessions', authRequired, async (req, res) => {
  const userId = currentUserId(req);

  const result = await query<{ id: string; created_at: Date; expires_at: Date }>(
    `SELECT id, created_at, expires_at FROM refresh_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC`,
    [userId]
  );

  res.set('Cache-Control', 'private, no-store');
  res.json({
    data: result.rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    })),
  });
});

router.delete('/sessions/:id', authRequired, async (req, res) => {
  const userId = currentUserId(req);
  const { id } = uuidParamSchema.parse(req.params);

  const result = await query(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [id, userId]
  );

  if (result.rowCount === 0) {
    throw new HttpError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada');
  }

  res.status(204).end();
});

export const authRouter = router;
