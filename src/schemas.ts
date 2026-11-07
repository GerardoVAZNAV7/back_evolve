import { z } from 'zod';

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }, 'Zona horaria inválida');

const emailSchema = z.string().trim().toLowerCase().max(254).email();

export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100),
  timezone: timezoneSchema.optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(500),
});

export const logoutSchema = refreshSchema;

export const profileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    weightKg: z.coerce.number().positive().max(500).optional(),
    heightCm: z.coerce.number().int().min(50).max(300).optional(),
    goal: z.string().trim().min(1).max(100).optional(),
    level: z.string().trim().min(1).max(50).optional(),
    timezone: timezoneSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Enviá al menos un campo para actualizar',
  });

export const exerciseListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  bodyPart: z.string().trim().max(50).optional(),
  equipment: z.string().trim().max(50).optional(),
  target: z.string().trim().max(50).optional(),
  muscleGroup: z.string().trim().max(50).optional(),
  lang: z.string().trim().max(10).default('es'),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

export const exerciseIdParamSchema = z.object({
  id: z.string().regex(/^\d{4}$/, 'El id debe tener 4 dígitos'),
});

export const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

const planExerciseSchema = z.object({
  exerciseId: z.string().trim().min(1).max(50),
  sets: z.coerce.number().int().min(1).max(50),
  reps: z.string().trim().min(1).max(30),
  restSeconds: z.coerce.number().int().min(0).max(3_600).optional(),
});

const planDaySchema = z.object({
  weekday: z.coerce.number().int().min(1).max(7),
  name: z.string().trim().min(1).max(80),
  exercises: z.array(planExerciseSchema).min(1).max(50),
});

export const planBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    goal: z.string().trim().min(1).max(100).default('Hipertrofia'),
    days: z.array(planDaySchema).min(1).max(7),
  })
  .superRefine((value, ctx) => {
    const weekdays = new Set<number>();
    value.days.forEach((day, dayIndex) => {
      if (weekdays.has(day.weekday)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Día de la semana repetido',
          path: ['days', dayIndex, 'weekday'],
        });
      }
      weekdays.add(day.weekday);

      const exerciseIds = new Set<string>();
      day.exercises.forEach((exercise, exerciseIndex) => {
        if (exerciseIds.has(exercise.exerciseId)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Ejercicio repetido en el mismo día',
            path: ['days', dayIndex, 'exercises', exerciseIndex, 'exerciseId'],
          });
        }
        exerciseIds.add(exercise.exerciseId);
      });
    });
  });

export type PlanBody = z.infer<typeof planBodySchema>;

export const workoutCreateSchema = z.object({
  planDayId: z.string().uuid().optional(),
});

export type WorkoutCreateBody = z.infer<typeof workoutCreateSchema>;

export const workoutSetSchema = z.object({
  exerciseId: z.string().trim().min(1).max(50),
  setNumber: z.coerce.number().int().min(1).max(100),
  weightKg: z.coerce.number().min(0).max(2_000).default(0),
  reps: z.coerce.number().int().min(1).max(1_000),
});

export type WorkoutSetBody = z.infer<typeof workoutSetSchema>;

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const recordsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
