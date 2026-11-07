import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', `Ruta no encontrada: ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Datos inválidos',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    const body: Record<string, unknown> = {
      error: { code: error.code, message: error.message },
    };
    if (error.details !== undefined) {
      (body.error as Record<string, unknown>).details = error.details;
    }
    res.status(error.status).json(body);
    return;
  }

  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'El cuerpo de la petición no es JSON válido' },
    });
    return;
  }

  console.error('Error no controlado:', error);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
  });
};
