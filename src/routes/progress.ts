import { Router } from 'express';
import { authRequired, currentUserId } from '../auth.js';
import { findExercise } from '../catalog.js';
import { query } from '../db.js';
import { recordsQuerySchema } from '../schemas.js';
import { getUserTimezone } from '../users.js';

const router = Router();
router.use(authRequired);

const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

router.get('/summary', async (req, res) => {
  const userId = currentUserId(req);
  const timezone = await getUserTimezone(userId);

  const [weekly, newPrs, days, clock] = await Promise.all([
    query<{ workouts: number; volume: number }>(
      `SELECT COUNT(DISTINCT (w.started_at AT TIME ZONE $2)::date)::int AS workouts,
              COALESCE(SUM(ws.weight_kg * ws.reps), 0)::float8 AS volume
       FROM workouts w
       LEFT JOIN workout_sets ws ON ws.workout_id = w.id
       WHERE w.user_id = $1
         AND w.finished_at IS NOT NULL
         AND (w.started_at AT TIME ZONE $2)::date >=
             date_trunc('week', (now() AT TIME ZONE $2))::date`,
      [userId, timezone]
    ),
    query<{ count: number }>(
      `WITH current_max AS (
         SELECT ws.exercise_id, MAX(ws.weight_kg) AS weight
         FROM workout_sets ws
         JOIN workouts w ON w.id = ws.workout_id
         WHERE w.user_id = $1 AND w.finished_at IS NOT NULL
         GROUP BY ws.exercise_id
       ),
       week_max AS (
         SELECT ws.exercise_id, MAX(ws.weight_kg) AS weight
         FROM workout_sets ws
         JOIN workouts w ON w.id = ws.workout_id
         WHERE w.user_id = $1
           AND w.finished_at IS NOT NULL
           AND (ws.completed_at AT TIME ZONE $2)::date >=
               date_trunc('week', (now() AT TIME ZONE $2))::date
         GROUP BY ws.exercise_id
       )
       SELECT COUNT(*)::int AS count
       FROM week_max wm
       JOIN current_max cm USING (exercise_id)
       WHERE wm.weight = cm.weight`,
      [userId, timezone]
    ),
    query<{ day: string }>(
      `SELECT to_char((w.started_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS day
       FROM workouts w
       WHERE w.user_id = $1 AND w.finished_at IS NOT NULL
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT 90`,
      [userId, timezone]
    ),
    query<{ today: string }>(
      `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS today`,
      [timezone]
    ),
  ]);

  const today = clock.rows[0]?.today;
  const workoutDays = new Set(days.rows.map((row) => row.day));
  let streakDays = 0;

  if (today) {
    let cursor = workoutDays.has(today) ? today : addDays(today, -1);
    while (workoutDays.has(cursor)) {
      streakDays += 1;
      cursor = addDays(cursor, -1);
    }
  }

  const weeklyRow = weekly.rows[0];
  res.set('Cache-Control', 'private, no-store');
  res.json({
    data: {
      streakDays,
      workoutsThisWeek: weeklyRow?.workouts ?? 0,
      weeklyVolumeKg: Math.round(Number(weeklyRow?.volume ?? 0)),
      newPrs: newPrs.rows[0]?.count ?? 0,
    },
  });
});

router.get('/volume', async (req, res) => {
  const userId = currentUserId(req);
  const timezone = await getUserTimezone(userId);

  const [mondayResult, volumeResult] = await Promise.all([
    query<{ monday: string }>(
      `SELECT to_char(date_trunc('week', (now() AT TIME ZONE $1)), 'YYYY-MM-DD') AS monday`,
      [timezone]
    ),
    query<{ date: string; kg: number }>(
      `SELECT to_char((ws.completed_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS date,
              COALESCE(SUM(ws.weight_kg * ws.reps), 0)::float8 AS kg
       FROM workout_sets ws
       JOIN workouts w ON w.id = ws.workout_id
       WHERE w.user_id = $1
         AND w.finished_at IS NOT NULL
         AND (ws.completed_at AT TIME ZONE $2)::date >=
             date_trunc('week', (now() AT TIME ZONE $2))::date
         AND (ws.completed_at AT TIME ZONE $2)::date <
             date_trunc('week', (now() AT TIME ZONE $2))::date + interval '7 days'
       GROUP BY 1
       ORDER BY 1`,
      [userId, timezone]
    ),
  ]);

  const monday = mondayResult.rows[0]?.monday;
  if (!monday) {
    res.json({ data: [] });
    return;
  }

  const byDate = new Map(volumeResult.rows.map((row) => [row.date, row.kg]));
  const data = WEEKDAY_LABELS.map((label, index) => {
    const date = addDays(monday, index);
    return {
      date,
      label,
      kg: Math.round(Number(byDate.get(date) ?? 0)),
    };
  });

  res.set('Cache-Control', 'private, no-store');
  res.json({ data });
});

router.get('/records', async (req, res) => {
  const userId = currentUserId(req);
  const timezone = await getUserTimezone(userId);
  const { limit } = recordsQuerySchema.parse(req.query);

  const result = await query<{
    exercise_id: string;
    weight_kg: number;
    reps: number;
    date: string;
  }>(
    `SELECT * FROM (
       SELECT DISTINCT ON (ws.exercise_id)
              ws.exercise_id,
              ws.weight_kg::float8 AS weight_kg,
              ws.reps,
              to_char((ws.completed_at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS date
       FROM workout_sets ws
       JOIN workouts w ON w.id = ws.workout_id
       WHERE w.user_id = $1 AND w.finished_at IS NOT NULL
       ORDER BY ws.exercise_id, ws.weight_kg DESC, ws.reps DESC, ws.completed_at DESC
     ) pr
     ORDER BY pr.date DESC, pr.weight_kg DESC
     LIMIT $3`,
    [userId, timezone, limit]
  );

  res.set('Cache-Control', 'private, no-store');
  res.json({
    data: result.rows.map((row) => ({
      exerciseId: row.exercise_id,
      exerciseName: findExercise(row.exercise_id)?.name ?? row.exercise_id,
      weightKg: row.weight_kg,
      reps: row.reps,
      date: row.date,
    })),
  });
});

export const progressRouter = router;
