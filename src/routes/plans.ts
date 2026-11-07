import type { PoolClient } from 'pg';
import { Router } from 'express';
import { authRequired, currentUserId } from '../auth.js';
import {
  fallbackSummary,
  findExercise,
  toExerciseSummary,
  type ExerciseSummary,
} from '../catalog.js';
import { query, withTransaction } from '../db.js';
import { HttpError } from '../errors.js';
import { mediaBaseUrl } from '../media.js';
import { planBodySchema, uuidParamSchema, type PlanBody } from '../schemas.js';

interface PlanRow {
  id: string;
  name: string;
  goal: string;
  is_active: boolean;
}

interface PlanSummaryRow extends PlanRow {
  exercise_count: number;
  days: number[] | null;
}

interface PlanDayExerciseRow {
  day_id: string;
  weekday: number;
  day_name: string;
  plan_exercise_id: string | null;
  exercise_id: string | null;
  position: number | null;
  sets: number | null;
  reps: string | null;
  rest_seconds: number | null;
}

interface PlanExerciseDto {
  id: string;
  exercise: ExerciseSummary;
  sets: number;
  reps: string;
  restSeconds: number | null;
  position: number;
}

interface PlanDayDto {
  id: string;
  weekday: number;
  name: string;
  exercises: PlanExerciseDto[];
}

interface PlanDetailDto {
  id: string;
  name: string;
  goal: string;
  isActive: boolean;
  days: PlanDayDto[];
}

const router = Router();
router.use(authRequired);

function validateExerciseIds(body: PlanBody): void {
  const ids = [...new Set(body.days.flatMap((day) => day.exercises.map((e) => e.exerciseId)))];
  const missing = ids.filter((id) => !findExercise(id));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      'UNKNOWN_EXERCISE',
      'Uno o más ejercicios no existen en el catálogo',
      { exerciseIds: missing }
    );
  }
}

async function insertPlanDays(
  client: PoolClient,
  planId: string,
  body: PlanBody
): Promise<void> {
  for (const day of body.days) {
    const dayResult = await client.query<{ id: string }>(
      'INSERT INTO plan_days (plan_id, weekday, name) VALUES ($1, $2, $3) RETURNING id',
      [planId, day.weekday, day.name]
    );
    const dayId = dayResult.rows[0]?.id;
    if (!dayId) {
      throw new HttpError(500, 'INTERNAL_ERROR', 'No se pudo crear el día del plan');
    }

    for (const [index, exercise] of day.exercises.entries()) {
      await client.query(
        `INSERT INTO plan_exercises
           (plan_day_id, exercise_id, position, sets, reps, rest_seconds)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          dayId,
          exercise.exerciseId,
          index + 1,
          exercise.sets,
          exercise.reps,
          exercise.restSeconds ?? null,
        ]
      );
    }
  }
}

async function getPlanSummaries(userId: string) {
  const result = await query<PlanSummaryRow>(
    `SELECT p.id, p.name, p.goal, p.is_active,
            COUNT(DISTINCT pe.id)::int AS exercise_count,
            COALESCE(
              array_agg(DISTINCT pd.weekday) FILTER (WHERE pd.weekday IS NOT NULL),
              '{}'
            ) AS days
     FROM plans p
     LEFT JOIN plan_days pd ON pd.plan_id = p.id
     LEFT JOIN plan_exercises pe ON pe.plan_day_id = pd.id
     WHERE p.user_id = $1
     GROUP BY p.id
     ORDER BY p.is_active DESC, p.created_at DESC`,
    [userId]
  );

  return result.rows.map((plan) => ({
    id: plan.id,
    name: plan.name,
    goal: plan.goal,
    isActive: plan.is_active,
    exerciseCount: plan.exercise_count,
    days: plan.days ?? [],
  }));
}

async function getPlanDetail(
  userId: string,
  planId: string,
  baseUrl: string
): Promise<PlanDetailDto | null> {
  const planResult = await query<PlanRow>(
    'SELECT id, name, goal, is_active FROM plans WHERE id = $1 AND user_id = $2',
    [planId, userId]
  );
  const plan = planResult.rows[0];
  if (!plan) {
    return null;
  }

  const rows = await query<PlanDayExerciseRow>(
    `SELECT pd.id AS day_id, pd.weekday, pd.name AS day_name,
            pe.id AS plan_exercise_id, pe.exercise_id, pe.position,
            pe.sets, pe.reps, pe.rest_seconds
     FROM plan_days pd
     LEFT JOIN plan_exercises pe ON pe.plan_day_id = pd.id
     WHERE pd.plan_id = $1
     ORDER BY pd.weekday, pe.position`,
    [planId]
  );

  const days = new Map<string, PlanDayDto>();
  for (const row of rows.rows) {
    let day = days.get(row.day_id);
    if (!day) {
      day = { id: row.day_id, weekday: row.weekday, name: row.day_name, exercises: [] };
      days.set(row.day_id, day);
    }

    if (row.plan_exercise_id && row.exercise_id && row.sets !== null && row.reps !== null) {
      const exercise = findExercise(row.exercise_id);
      day.exercises.push({
        id: row.plan_exercise_id,
        exercise: exercise
          ? toExerciseSummary(exercise, baseUrl)
          : fallbackSummary(row.exercise_id),
        sets: row.sets,
        reps: row.reps,
        restSeconds: row.rest_seconds,
        position: row.position ?? day.exercises.length + 1,
      });
    }
  }

  return {
    id: plan.id,
    name: plan.name,
    goal: plan.goal,
    isActive: plan.is_active,
    days: [...days.values()],
  };
}

router.get('/', async (req, res) => {
  const userId = currentUserId(req);
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await getPlanSummaries(userId) });
});

router.get('/:id', async (req, res) => {
  const userId = currentUserId(req);
  const { id } = uuidParamSchema.parse(req.params);
  const plan = await getPlanDetail(userId, id, mediaBaseUrl(req));
  if (!plan) {
    throw new HttpError(404, 'PLAN_NOT_FOUND', 'Plan no encontrado');
  }
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: plan });
});

router.post('/', async (req, res) => {
  const userId = currentUserId(req);
  const body = planBodySchema.parse(req.body);
  validateExerciseIds(body);

  const planId = await withTransaction(async (client) => {
    const active = await client.query(
      'SELECT 1 FROM plans WHERE user_id = $1 AND is_active LIMIT 1',
      [userId]
    );
    const isFirstPlan = (active.rowCount ?? 0) === 0;

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO plans (user_id, name, goal, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, body.name, body.goal, isFirstPlan]
    );
    const newPlanId = inserted.rows[0]?.id;
    if (!newPlanId) {
      throw new HttpError(500, 'INTERNAL_ERROR', 'No se pudo crear el plan');
    }

    await insertPlanDays(client, newPlanId, body);
    return newPlanId;
  });

  const plan = await getPlanDetail(userId, planId, mediaBaseUrl(req));
  res.status(201).json({ data: plan });
});

router.put('/:id', async (req, res) => {
  const userId = currentUserId(req);
  const { id } = uuidParamSchema.parse(req.params);
  const body = planBodySchema.parse(req.body);
  validateExerciseIds(body);

  await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE plans SET name = $3, goal = $4, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, userId, body.name, body.goal]
    );
    if (!updated.rows[0]) {
      throw new HttpError(404, 'PLAN_NOT_FOUND', 'Plan no encontrado');
    }

    await client.query('DELETE FROM plan_days WHERE plan_id = $1', [id]);
    await insertPlanDays(client, id, body);
  });

  const plan = await getPlanDetail(userId, id, mediaBaseUrl(req));
  res.json({ data: plan });
});

router.delete('/:id', async (req, res) => {
  const userId = currentUserId(req);
  const { id } = uuidParamSchema.parse(req.params);
  const deleted = await query(
    'DELETE FROM plans WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  if (!deleted.rows[0]) {
    throw new HttpError(404, 'PLAN_NOT_FOUND', 'Plan no encontrado');
  }
  res.status(204).end();
});

router.post('/:id/activate', async (req, res) => {
  const userId = currentUserId(req);
  const { id } = uuidParamSchema.parse(req.params);

  await withTransaction(async (client) => {
    const target = await client.query(
      'SELECT id FROM plans WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId]
    );
    if (!target.rows[0]) {
      throw new HttpError(404, 'PLAN_NOT_FOUND', 'Plan no encontrado');
    }

    await client.query(
      `UPDATE plans SET is_active = false, updated_at = now()
       WHERE user_id = $1 AND id <> $2 AND is_active`,
      [userId, id]
    );
    await client.query(
      'UPDATE plans SET is_active = true, updated_at = now() WHERE id = $1',
      [id]
    );
  });

  const plan = await getPlanDetail(userId, id, mediaBaseUrl(req));
  res.json({ data: plan });
});

export const plansRouter = router;
