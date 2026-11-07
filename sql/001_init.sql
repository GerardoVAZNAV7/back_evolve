CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name          text NOT NULL,
  weight_kg     numeric(5, 2) CHECK (weight_kg > 0 AND weight_kg <= 500),
  height_cm     integer CHECK (height_cm BETWEEN 50 AND 300),
  goal          text,
  level         text,
  timezone      text NOT NULL DEFAULT 'UTC',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);

CREATE TABLE IF NOT EXISTS plans (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name       text NOT NULL,
  goal       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plans_user_id_idx ON plans (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS plans_one_active_per_user_idx
  ON plans (user_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS plan_days (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  name    text NOT NULL,
  UNIQUE (plan_id, weekday)
);

CREATE TABLE IF NOT EXISTS plan_exercises (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_day_id  uuid NOT NULL REFERENCES plan_days (id) ON DELETE CASCADE,
  exercise_id  text NOT NULL,
  position     integer NOT NULL CHECK (position > 0),
  sets         integer NOT NULL CHECK (sets BETWEEN 1 AND 50),
  reps         text NOT NULL,
  rest_seconds integer CHECK (rest_seconds BETWEEN 0 AND 3600),
  UNIQUE (plan_day_id, position)
);

CREATE INDEX IF NOT EXISTS plan_exercises_day_idx ON plan_exercises (plan_day_id);

CREATE TABLE IF NOT EXISTS workouts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_day_id uuid REFERENCES plan_days (id) ON DELETE SET NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  notes       text
);

CREATE INDEX IF NOT EXISTS workouts_user_started_idx ON workouts (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS workout_sets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id   uuid NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
  exercise_id  text NOT NULL,
  set_number   integer NOT NULL CHECK (set_number BETWEEN 1 AND 100),
  weight_kg    numeric(7, 2) NOT NULL DEFAULT 0 CHECK (weight_kg >= 0),
  reps         integer NOT NULL CHECK (reps BETWEEN 1 AND 1000),
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workout_id, exercise_id, set_number)
);

CREATE INDEX IF NOT EXISTS workout_sets_workout_idx ON workout_sets (workout_id);
CREATE INDEX IF NOT EXISTS workout_sets_exercise_idx ON workout_sets (exercise_id);
