import type { RequestHandler } from 'express';
import { Router } from 'express';
import {
  catalogMeta,
  findExercise,
  hasLanguage,
  listExercises,
  toExerciseDetail,
} from '../catalog.js';
import { HttpError } from '../errors.js';
import { mediaBaseUrl } from '../media.js';
import { exerciseIdParamSchema, exerciseListQuerySchema } from '../schemas.js';

const router = Router();

export const metaHandler: RequestHandler = (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ data: catalogMeta() });
};

router.get('/', (req, res) => {
  const query = exerciseListQuerySchema.parse(req.query);
  if (!hasLanguage(query.lang)) {
    throw new HttpError(
      400,
      'INVALID_LANGUAGE',
      `Idioma no soportado. Usá uno de: ${catalogMeta().languages.join(', ')}`
    );
  }

  const { data, total } = listExercises(query, mediaBaseUrl(req));
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    data,
    pagination: {
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + data.length < total,
    },
  });
});

router.get('/:id', (req, res) => {
  const { id } = exerciseIdParamSchema.parse(req.params);
  const exercise = findExercise(id);
  if (!exercise) {
    throw new HttpError(404, 'EXERCISE_NOT_FOUND', `No existe el ejercicio ${id}`);
  }

  const language = typeof req.query.lang === 'string' ? req.query.lang : 'es';
  if (!hasLanguage(language)) {
    throw new HttpError(
      400,
      'INVALID_LANGUAGE',
      `Idioma no soportado. Usá uno de: ${catalogMeta().languages.join(', ')}`
    );
  }

  res.set('Cache-Control', 'public, max-age=300');
  res.json({ data: toExerciseDetail(exercise, language, mediaBaseUrl(req)) });
});

export const exercisesRouter = router;
