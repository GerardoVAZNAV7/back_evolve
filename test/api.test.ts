import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  test('API end-to-end (omitida: falta TEST_DATABASE_URL)', { skip: true }, () => {});
} else {
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';

  const { app } = await import('../src/app.js');
  const { runMigrations } = await import('../src/migrate.js');
  const { query, closePool } = await import('../src/db.js');

  await runMigrations();

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  test.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  });

  async function api(
    path: string,
    init: { method?: string; token?: string; body?: unknown } = {}
  ): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = {};
    if (init.token) {
      headers.authorization = `Bearer ${init.token}`;
    }
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  test('flujo completo: registro, plan, entrenamiento y progreso', async () => {
    const email = `api-${Date.now()}@evolve.test`;
    const password = 'contraseña-de-prueba';

    const register = await api('/api/v1/auth/register', {
      method: 'POST',
      body: { email, password, name: 'Test', timezone: 'UTC' },
    });
    assert.equal(register.status, 201);
    const accessToken: string = register.body.accessToken;
    const refreshToken: string = register.body.refreshToken;
    assert.ok(accessToken && refreshToken);
    assert.equal(register.body.user.email, email);

    const duplicate = await api('/api/v1/auth/register', {
      method: 'POST',
      body: { email, password, name: 'Test' },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'EMAIL_TAKEN');

    const profile = await api('/api/v1/profile', { token: accessToken });
    assert.equal(profile.status, 200);
    assert.equal(profile.body.data.email, email);

    const patched = await api('/api/v1/profile', {
      method: 'PATCH',
      token: accessToken,
      body: { weightKg: 80, goal: 'Fuerza' },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.weightKg, 80);
    assert.equal(patched.body.data.goal, 'Fuerza');

    const catalog = await api('/api/v1/exercises?limit=2');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.data.length, 2);
    const [first, second] = catalog.body.data;

    const detail = await api(`/api/v1/exercises/${first.id}?lang=es`);
    assert.equal(detail.status, 200);
    assert.ok(detail.body.data.instructions.length > 0);

    const utcDay = new Date().getUTCDay();
    const weekday = utcDay === 0 ? 7 : utcDay;

    const createdPlan = await api('/api/v1/plans', {
      method: 'POST',
      token: accessToken,
      body: {
        name: 'Plan de prueba',
        goal: 'Hipertrofia',
        days: [
          {
            weekday,
            name: 'Hoy',
            exercises: [
              { exerciseId: first.id, sets: 3, reps: '8-12', restSeconds: 90 },
              { exerciseId: second.id, sets: 3, reps: '10' },
            ],
          },
        ],
      },
    });
    assert.equal(createdPlan.status, 201);
    assert.equal(createdPlan.body.data.isActive, true);
    assert.equal(createdPlan.body.data.days[0].exercises.length, 2);

    const plans = await api('/api/v1/plans', { token: accessToken });
    assert.equal(plans.body.data.length, 1);
    assert.equal(plans.body.data[0].exerciseCount, 2);

    const today = await api('/api/v1/workouts/today', { token: accessToken });
    assert.equal(today.status, 200);
    assert.equal(today.body.data.dayName, 'Hoy');
    assert.equal(today.body.data.exercises.length, 2);

    const started = await api('/api/v1/workouts', {
      method: 'POST',
      token: accessToken,
      body: {},
    });
    assert.equal(started.status, 201);
    const workoutId: string = started.body.data.id;

    const secondStart = await api('/api/v1/workouts', {
      method: 'POST',
      token: accessToken,
      body: {},
    });
    assert.equal(secondStart.status, 409);
    assert.equal(secondStart.body.error.code, 'WORKOUT_IN_PROGRESS');

    const set1 = await api(`/api/v1/workouts/${workoutId}/sets`, {
      method: 'POST',
      token: accessToken,
      body: { exerciseId: first.id, setNumber: 1, weightKg: 50, reps: 10 },
    });
    assert.equal(set1.status, 200);
    assert.equal(set1.body.data.weightKg, 50);

    const set2 = await api(`/api/v1/workouts/${workoutId}/sets`, {
      method: 'POST',
      token: accessToken,
      body: { exerciseId: first.id, setNumber: 2, weightKg: 40, reps: 10 },
    });
    assert.equal(set2.status, 200);

    const corrected = await api(`/api/v1/workouts/${workoutId}/sets`, {
      method: 'POST',
      token: accessToken,
      body: { exerciseId: first.id, setNumber: 1, weightKg: 55, reps: 10 },
    });
    assert.equal(corrected.body.data.weightKg, 55);

    const finished = await api(`/api/v1/workouts/${workoutId}/finish`, {
      method: 'POST',
      token: accessToken,
    });
    assert.equal(finished.status, 200);
    assert.ok(finished.body.data.finishedAt);

    const setAfterFinish = await api(`/api/v1/workouts/${workoutId}/sets`, {
      method: 'POST',
      token: accessToken,
      body: { exerciseId: first.id, setNumber: 3, weightKg: 60, reps: 5 },
    });
    assert.equal(setAfterFinish.status, 409);

    const history = await api('/api/v1/workouts', { token: accessToken });
    assert.equal(history.body.data.length, 1);
    assert.equal(history.body.data[0].setCount, 2);
    assert.equal(history.body.data[0].volumeKg, 950);

    const workoutDetail = await api(`/api/v1/workouts/${workoutId}`, {
      token: accessToken,
    });
    assert.equal(workoutDetail.body.data.sets.length, 2);

    const summary = await api('/api/v1/progress/summary', { token: accessToken });
    assert.equal(summary.status, 200);
    assert.equal(summary.body.data.workoutsThisWeek, 1);
    assert.equal(summary.body.data.weeklyVolumeKg, 950);
    assert.equal(summary.body.data.streakDays, 1);

    const volume = await api('/api/v1/progress/volume', { token: accessToken });
    assert.equal(volume.body.data.length, 7);
    assert.equal(
      volume.body.data.reduce((total: number, day: any) => total + day.kg, 0),
      950
    );

    const records = await api('/api/v1/progress/records', { token: accessToken });
    assert.equal(records.body.data[0].exerciseId, first.id);
    assert.equal(records.body.data[0].weightKg, 55);

    const refreshed = await api('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    });
    assert.equal(refreshed.status, 200);
    assert.notEqual(refreshed.body.refreshToken, refreshToken);

    const reuse = await api('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    });
    assert.equal(reuse.status, 401);
    assert.equal(reuse.body.error.code, 'REFRESH_TOKEN_REUSED');

    const familyRevoked = await api('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: refreshed.body.refreshToken },
    });
    assert.equal(familyRevoked.status, 401);

    const logout = await api('/api/v1/auth/logout', {
      method: 'POST',
      body: { refreshToken: refreshed.body.refreshToken },
    });
    assert.equal(logout.status, 204);

    const afterLogout = await api('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: refreshed.body.refreshToken },
    });
    assert.equal(afterLogout.status, 401);

    const unauthorized = await api('/api/v1/plans');
    assert.equal(unauthorized.status, 401);

    const sessionLogin = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    assert.equal(sessionLogin.status, 200);

    const sessions = await api('/api/v1/auth/sessions', {
      token: sessionLogin.body.accessToken,
    });
    assert.equal(sessions.status, 200);
    assert.equal(sessions.body.data.length, 1);
    const sessionId: string = sessions.body.data[0].id;

    const removedSession = await api(`/api/v1/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      token: sessionLogin.body.accessToken,
    });
    assert.equal(removedSession.status, 204);

    const revokedSession = await api('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: sessionLogin.body.refreshToken },
    });
    assert.equal(revokedSession.status, 401);

    const missingSession = await api(`/api/v1/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      token: sessionLogin.body.accessToken,
    });
    assert.equal(missingSession.status, 404);

    const forgot = await api('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: { email },
    });
    assert.equal(forgot.status, 202);
    assert.ok(forgot.body.debugResetToken);

    const unknownEmail = await api('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: { email: `nadie-${Date.now()}@evolve.test` },
    });
    assert.equal(unknownEmail.status, 202);
    assert.equal(unknownEmail.body.debugResetToken, undefined);

    const newPassword = 'otra-contraseña-123';
    const reset = await api('/api/v1/auth/reset-password', {
      method: 'POST',
      body: { token: forgot.body.debugResetToken, password: newPassword },
    });
    assert.equal(reset.status, 204);

    const oldPasswordLogin = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    assert.equal(oldPasswordLogin.status, 401);

    const newPasswordLogin = await api('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password: newPassword },
    });
    assert.equal(newPasswordLogin.status, 200);

    const resetReuse = await api('/api/v1/auth/reset-password', {
      method: 'POST',
      body: { token: forgot.body.debugResetToken, password: 'tercera-contraseña-123' },
    });
    assert.equal(resetReuse.status, 400);
    assert.equal(resetReuse.body.error.code, 'INVALID_RESET_TOKEN');

    await query('DELETE FROM users WHERE email = $1', [email]);
  });
}
