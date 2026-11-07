import type { Request } from 'express';
import { config } from './config.js';

export function mediaBaseUrl(req: Request): string {
  const base =
    config.mediaBaseUrl ||
    process.env.RENDER_EXTERNAL_URL ||
    `${req.protocol}://${req.get('host')}`;
  return base.replace(/\/+$/, '');
}

export function mediaUrl(baseUrl: string, relativePath: string): string {
  return `${baseUrl}/media/${relativePath.replace(/^\/+/, '')}`;
}
