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

// Refresh/logout van con token opaco: no necesitan el límite anti-fuerza-bruta
// de login, y 10/15 min bloqueaba varias sesiones detrás de una misma IP (CGNAT).
export const sessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
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
