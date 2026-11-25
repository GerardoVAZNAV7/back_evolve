import { Router } from 'express';
import { authRequired, currentUserId } from '../auth.js';
import { query } from '../db.js';
import { HttpError } from '../errors.js';
import { profileUpdateSchema } from '../schemas.js';
import { publicUser, type UserRow } from '../users.js';

const router = Router();

const userColumns = `
  id, email, name, weight_kg, height_cm, goal, level, timezone, created_at
`;

router.get('/', authRequired, async (req, res) => {
  const userId = currentUserId(req);
  const result = await query<UserRow>(
    `SELECT ${userColumns} FROM users WHERE id = $1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) {
    throw new HttpError(404, 'USER_NOT_FOUND', 'Usuario no encontrado');
  }
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: publicUser(user) });
});

router.patch('/', authRequired, async (req, res) => {
  const userId = currentUserId(req);
  const body = profileUpdateSchema.parse(req.body);

  const result = await query<UserRow>(
    `UPDATE users SET
       name = COALESCE($2, name),
       weight_kg = COALESCE($3, weight_kg),
       height_cm = COALESCE($4, height_cm),
       goal = COALESCE($5, goal),
       level = COALESCE($6, level),
       timezone = COALESCE($7, timezone),
       updated_at = now()
     WHERE id = $1
     RETURNING ${userColumns}`,
    [
      userId,
      body.name ?? null,
      body.weightKg ?? null,
      body.heightCm ?? null,
      body.goal ?? null,
      body.level ?? null,
      body.timezone ?? null,
    ]
  );

  const user = result.rows[0];
  if (!user) {
    throw new HttpError(404, 'USER_NOT_FOUND', 'Usuario no encontrado');
  }
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: publicUser(user) });
});

router.delete('/', authRequired, async (req, res) => {
  const userId = currentUserId(req);
  // Las tablas dependientes tienen ON DELETE CASCADE hacia users.
  const result = await query('DELETE FROM users WHERE id = $1', [userId]);
  if (result.rowCount === 0) {
    throw new HttpError(404, 'USER_NOT_FOUND', 'Usuario no encontrado');
  }
  res.set('Cache-Control', 'private, no-store');
  res.status(204).end();
});

export const profileRouter = router;
