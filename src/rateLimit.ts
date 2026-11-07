import rateLimit from 'express-rate-limit';

const message = {
  error: {
    code: 'RATE_LIMITED',
    message: 'Demasiadas peticiones. Probá de nuevo más tarde.',
  },
};

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});
