import { Router } from 'express';
import { authRequired, currentUserId } from '../auth.js';
import {
  fallbackSummary,
  findExercise,
  toExerciseSummary,
  type ExerciseSummary,
} from '../catalog.js';
import { query } from '../db.js';
import { HttpError } from '../errors.js';
import { mediaBaseUrl } from '../media.js';
import {
  historyQuerySchema,
  uuidParamSchema,
  workoutCreateSchema,
  workoutSetSchema,
} from '../schemas.js';
import { getUserTimezone } from '../users.js';

interface TodayDayRow {
  plan_id: string;
  plan_name: string;
  day_id: string;
  day_name: string;
}

interface TodayExerciseRow {
  id: string;
  exercise_id: string;
  position: number;
  sets: number;
  reps: string;
  rest_seconds: number | null;
  last_weight_kg: number | null;
}

interface WorkoutRow {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  notes: string | null;
  plan_day_id: string | null;
}

interface WorkoutSetRow {
  id: string;
  exercise_id: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  completed_at: Date;
}

interface WorkoutHistoryRow extends WorkoutRow {
  set_count: number;
  volume_kg: number;
}

const router = Router();
router.use(authRequired);

function exerciseSummary(exerciseId: string, baseUrl: string): ExerciseSummary {
  const exercise = findExercise(exerciseId);
  return exercise ? toExerciseSummary(exercise, baseUrl) : fallbackSummary(exerciseId);
}

async function findOpenWorkoutToday(userId: string, timezone: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT id FROM workouts
     WHERE user_id = $1
       AND finished_at IS NULL
       AND (started_at AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date
     ORDER BY started_at DESC
     LIMIT 1`,
    [userId, timezone]
  );
  return result.rows[0]?.id ?? null;
}

router.get('/today', async (req, res) => {
  const userId = currentUserId(req);
  const timezone = await getUserTimezone(userId);

  const clock = await query<{ weekday: number }>(
    'SELECT EXTRACT(ISODOW FROM (now() AT TIME ZONE $1))::int AS weekday',
    [timezone]
  );
  const weekday = clock.rows[0]?.weekday;

  const dayResult = await query<TodayDayRow>(
    `SELECT p.id AS plan_id, p.name AS plan_name, pd.id AS day_id, pd.name AS day_name
     FROM plans p
     JOIN plan_days pd ON pd.plan_id = p.id
     WHERE p.user_id = $1 AND p.is_active AND pd.weekday = $2
     LIMIT 1`,
    [userId, weekday]
  );
  const day = dayResult.rows[0];
  if (!day) {
    res.set('Cache-Control', 'private, no-store');
    res.json({ data: null });
    return;
  }

  const exercisesResult = await query<TodayExerciseRow>(
    `SELECT pe.id, pe.exercise_id, pe.position, pe.sets, pe.reps, pe.rest_seconds,
            (SELECT ws.weight_kg::float8
             FROM workout_sets ws
             JOIN workouts w ON w.id = ws.workout_id
             WHERE w.user_id = $1 AND ws.exercise_id = pe.exercise_id
             ORDER BY ws.completed_at DESC
             LIMIT 1) AS last_weight_kg
     FROM plan_exercises pe
     WHERE pe.plan_day_id = $2
     ORDER BY pe.position`,
    [userId, day.day_id]
  );

  const baseUrl = mediaBaseUrl(req);
  const workoutId = await findOpenWorkoutToday(userId, timezone);

  res.set('Cache-Control', 'private, no-store');
  res.json({
    data: {
      planId: day.plan_id,
      planName: day.plan_name,
      dayId: day.day_id,
      dayName: day.day_name,
      workoutId,
      exercises: exercisesResult.rows.map((row) => ({
        id: row.id,
        exercise: exerciseSummary(row.exercise_id, baseUrl),
        sets: row.sets,
        reps: row.reps,
        restSeconds: row.rest_seconds,
        position: row.position,
        lastWeightKg: row.last_weight_kg,
      })),
    },
  });
});

router.post('/', async (req, res) => {
  const userId = currentUserId(req);
  const body = workoutCreateSchema.parse(req.body ?? {});
  const timezone = await getUserTimezone(userId);

  let planDayId = body.planDayId ?? null;

  if (planDayId) {
    const owned = await query(
      `SELECT pd.id
       FROM plan_days pd
       JOIN plans p ON p.id = pd.plan_id
       WHERE pd.id = $1 AND p.user_id = $2`,
      [planDayId, userId]
    );
    if (!owned.rows[0]) {
      throw new HttpError(404, 'PLAN_DAY_NOT_FOUND', 'Día de plan no encontrado');
    }
  } else {
    const todayDay = await query<{ id: string }>(
      `SELECT pd.id
       FROM plans p
       JOIN plan_days pd ON pd.plan_id = p.id
       WHERE p.user_id = $1 AND p.is_active
         AND pd.weekday = EXTRACT(ISODOW FROM (now() AT TIME ZONE $2))::int
       LIMIT 1`,
      [userId, timezone]
    );
    planDayId = todayDay.rows[0]?.id ?? null;
  }

  const openWorkout = await findOpenWorkoutToday(userId, timezone);
  if (openWorkout) {
    throw new HttpError(
      409,
      'WORKOUT_IN_PROGRESS',
      'Ya hay un entrenamiento sin terminar hoy',
      { workoutId: openWorkout }
    );
  }

  const inserted = await query<WorkoutRow>(
    `INSERT INTO workouts (user_id, plan_day_id)
     VALUES ($1, $2)
     RETURNING id, started_at, finished_at, notes, plan_day_id`,
    [userId, planDayId]
  );
  const workout = inserted.rows[0];
  if (!workout) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'No se pudo iniciar el entrenamiento');
  }

  res.status(201).json({
    data: {
      id: workout.id,
      startedAt: workout.started_at,
      finishedAt: workout.finished_at,
      planDayId: workout.plan_day_id,
    },
  });
});

router.post('/:id/sets', async (req, res) => {
  const userId = currentUserId(req);
  const { id } = uuidParamSchema.parse(req.params);
  const body = workoutSetSchema.parse(req.body);

  const workoutResult = await query<{ id: string; finished_at: Date | null }>(
    'SELECT id, finished_at FROM workouts WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  const workout = workoutResult.rows[0];
  if (!workout) {
    throw new HttpError(404, 'WORKOUT_NOT_FOUND', 'Entrenamiento no encontrado');
  }
  if (workout.finished_at) {
    throw new HttpError(409, 'WORKOUT_FINISHED', 'El entrenamiento ya terminó');
  }

  if (!findExercise(body.exerciseId)) {
    throw new HttpError(400, 'UNKNOWN_EXERCISE', 'El ejercicio no existe en el catálogo');
  }

  const saved = await query<WorkoutSetRow>(
    `INSERT INTO workout_sets (workout_id, exercise_id, set_number, weight_kg, reps)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workout_id, exercise_id, set_number)
     DO UPDATE SET weight_kg = EXCLUDED.weight_kg,
                   reps = EXCLUDED.reps,
                   completed_at = now()
     RETURNING id, exercise_id, set_number, weight_kg::float8 AS weight_kg, reps, completed_at`,
    [id, body.exerciseId, body.setNumber, body.weightKg, body.reps]
  );
  const set = saved.rows[0];
  if (!set) {
    throw new HttpError(500, 'INTERNAL_ERROR', 'No se pudo guardar la serie');
  }

  res.json({
    data: {
      id: set.id,
      exercise: exerciseSummary(set.exercise_id, mediaBaseUrl(req)),
      setNumber: set.set_number,
      weightKg: set.weight_kg,
      reps: set.reps,
      completedAt: set.completed_at,
    },
  });
});

router.post('/:id/finish', async (req, res) => {
  const userId = currentUserId(req);
  const { id } = uuidParamSchema.parse(req.params);

  const result = await query<WorkoutRow>(
    `UPDATE workouts
     SET finished_at = COALESCE(finished_at, now())
     WHERE id = $1 AND user_id = $2
     RETURNING id, started_at, finished_at, notes, plan_day_id`,
    [id, userId]
  );
  const workout = result.rows[0];
  if (!workout) {
    throw new HttpError(404, 'WORKOUT_NOT_FOUND', 'Entrenamiento no encontrado');
  }

  res.json({
    data: {
      id: workout.id,
      startedAt: workout.started_at,
      finishedAt: workout.finished_at,
      planDayId: workout.plan_day_id,
    },
  });
});

router.get('/', async (req, res) => {
  const userId = currentUserId(req);
  const { limit, offset } = historyQuerySchema.parse(req.query);

  const [workouts, count] = await Promise.all([
    query<WorkoutHistoryRow>(
      `SELECT w.id, w.started_at, w.finished_at, w.notes, w.plan_day_id,
              COUNT(ws.id)::int AS set_count,
              COALESCE(SUM(ws.weight_kg * ws.reps), 0)::float8 AS volume_kg
       FROM workouts w
       LEFT JOIN workout_sets ws ON ws.workout_id = w.id
       WHERE w.user_id = $1
       GROUP BY w.id
       ORDER BY w.started_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    query<{ total: number }>(
      'SELECT COUNT(*)::int AS total FROM workouts WHERE user_id = $1',
      [userId]
    ),
  ]);

  const total = count.rows[0]?.total ?? 0;
  res.set('Cache-Control', 'private, no-store');
  res.json({
    data: workouts.rows.map((workout) => ({
      id: workout.id,
      startedAt: workout.started_at,
      finishedAt: workout.finished_at,
      notes: workout.notes,
      planDayId: workout.plan_day_id,
      setCount: workout.set_count,
      volumeKg: workout.volume_kg,
    })),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + workouts.rows.length < total,
    },
  });
});

router.get('/:id', async (req, res) => {
  const userId = currentUserId(req);
  const { id } = uuidParamSchema.parse(req.params);

  const workoutResult = await query<WorkoutRow>(
    `SELECT id, started_at, finished_at, notes, plan_day_id
     FROM workouts WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  const workout = workoutResult.rows[0];
  if (!workout) {
    throw new HttpError(404, 'WORKOUT_NOT_FOUND', 'Entrenamiento no encontrado');
  }

  const setsResult = await query<WorkoutSetRow>(
    `SELECT id, exercise_id, set_number, weight_kg::float8 AS weight_kg, reps, completed_at
     FROM workout_sets
     WHERE workout_id = $1
     ORDER BY completed_at, set_number`,
    [id]
  );

  const baseUrl = mediaBaseUrl(req);
  res.set('Cache-Control', 'private, no-store');
  res.json({
    data: {
      id: workout.id,
      startedAt: workout.started_at,
      finishedAt: workout.finished_at,
      notes: workout.notes,
      planDayId: workout.plan_day_id,
      sets: setsResult.rows.map((set) => ({
        id: set.id,
        exercise: exerciseSummary(set.exercise_id, baseUrl),
        setNumber: set.set_number,
        weightKg: set.weight_kg,
        reps: set.reps,
        completedAt: set.completed_at,
      })),
    },
  });
});

export const workoutsRouter = router;
