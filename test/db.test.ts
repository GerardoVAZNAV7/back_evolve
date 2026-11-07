import assert from 'node:assert/strict';
import test from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  test('integración con PostgreSQL (omitida: falta TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = 'test';

  const { runMigrations } = await import('../src/migrate.js');
  const { query, closePool } = await import('../src/db.js');

  test.after(async () => {
    await closePool();
  });

  test('las migraciones aplican el esquema y son idempotentes', async () => {
    await runMigrations();
    const second = await runMigrations();
    assert.deepEqual(second, []);

    const applied = await query<{ name: string }>('SELECT name FROM schema_migrations');
    assert.ok(applied.rows.some((row) => row.name === '001_init.sql'));
  });

  test('el borrado de usuario arrastra planes y entrenamientos', async () => {
    const email = `test-${Date.now()}@evolve.test`;
    const user = await query<{ id: string }>(
      "INSERT INTO users (email, password_hash, name) VALUES ($1, 'x', 'Test') RETURNING id",
      [email]
    );
    const userId = user.rows[0]?.id;
    assert.ok(userId);

    const plan = await query<{ id: string }>(
      "INSERT INTO plans (user_id, name, goal, is_active) VALUES ($1, 'Plan', 'Fuerza', true) RETURNING id",
      [userId]
    );
    const planId = plan.rows[0]?.id;
    assert.ok(planId);

    const day = await query<{ id: string }>(
      "INSERT INTO plan_days (plan_id, weekday, name) VALUES ($1, 1, 'Lunes') RETURNING id",
      [planId]
    );
    const dayId = day.rows[0]?.id;
    assert.ok(dayId);

    const workout = await query<{ id: string }>(
      'INSERT INTO workouts (user_id, plan_day_id) VALUES ($1, $2) RETURNING id',
      [userId, dayId]
    );
    const workoutId = workout.rows[0]?.id;
    assert.ok(workoutId);

    await query(
      'INSERT INTO workout_sets (workout_id, exercise_id, set_number, weight_kg, reps) VALUES ($1, $2, 1, 50, 10)',
      [workoutId, '0001']
    );

    const volume = await query<{ volume: number }>(
      'SELECT COALESCE(SUM(weight_kg * reps), 0)::float8 AS volume FROM workout_sets WHERE workout_id = $1',
      [workoutId]
    );
    assert.equal(volume.rows[0]?.volume, 500);

    const duplicate = await query(
      'SELECT 1 FROM plans WHERE user_id = $1 AND is_active',
      [userId]
    );
    assert.equal(duplicate.rowCount, 1);

    await assert.rejects(
      () =>
        query(
          "INSERT INTO plans (user_id, name, goal, is_active) VALUES ($1, 'Otro', 'Fuerza', true)",
          [userId]
        ),
      /plans_one_active_per_user_idx/
    );

    await query('DELETE FROM users WHERE id = $1', [userId]);

    const remaining = await query<{ workouts: number; sets: number }>(
      `SELECT (SELECT COUNT(*)::int FROM workouts WHERE user_id = $1) AS workouts,
              (SELECT COUNT(*)::int FROM workout_sets WHERE workout_id = $2) AS sets`,
      [userId, workoutId]
    );
    assert.equal(remaining.rows[0]?.workouts, 0);
    assert.equal(remaining.rows[0]?.sets, 0);
  });
}
