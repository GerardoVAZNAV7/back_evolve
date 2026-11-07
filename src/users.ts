import { query } from './db.js';
import { HttpError } from './errors.js';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash?: string;
  weight_kg: string | null;
  height_cm: number | null;
  goal: string | null;
  level: string | null;
  timezone: string;
  created_at: Date;
}

export function publicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
    heightCm: row.height_cm,
    goal: row.goal,
    level: row.level,
    timezone: row.timezone,
    createdAt: row.created_at,
  };
}

export async function getUserTimezone(userId: string): Promise<string> {
  const result = await query<{ timezone: string }>(
    'SELECT timezone FROM users WHERE id = $1',
    [userId]
  );
  const timezone = result.rows[0]?.timezone;
  if (!timezone) {
    throw new HttpError(404, 'USER_NOT_FOUND', 'Usuario no encontrado');
  }
  return timezone;
}
