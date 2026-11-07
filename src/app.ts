import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { apiLimiter } from './rateLimit.js';
import { authRouter } from './routes/auth.js';
import { exercisesRouter, metaHandler } from './routes/exercises.js';
import { plansRouter } from './routes/plans.js';
import { profileRouter } from './routes/profile.js';
import { progressRouter } from './routes/progress.js';
import { workoutsRouter } from './routes/workouts.js';

export const app = express();

app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin:
      config.corsOrigin === '*'
        ? true
        : config.corsOrigin.split(',').map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  })
);
app.use(compression());
app.use(express.json({ limit: '100kb' }));

app.use(
  '/media',
  express.static(config.publicDir, {
    maxAge: '30d',
    immutable: true,
  })
);

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

app.get('/', (_req, res) => {
  res.json({
    name: 'Evolve API',
    version: 'v1',
    docs: '/api/v1/meta',
    media: '/media/images/',
  });
});

app.use('/api', apiLimiter);

app.get('/api/v1/meta', metaHandler);

app.use('/api/v1/auth', authRouter);
app.use('/api/v1/profile', profileRouter);
app.use('/api/v1/exercises', exercisesRouter);
app.use('/api/v1/plans', plansRouter);
app.use('/api/v1/workouts', workoutsRouter);
app.use('/api/v1/progress', progressRouter);

app.use(notFoundHandler);
app.use(errorHandler);
