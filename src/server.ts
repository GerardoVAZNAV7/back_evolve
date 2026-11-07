import { app } from './app.js';
import { config } from './config.js';
import { closePool } from './db.js';

const server = app.listen(config.port, () => {
  console.log(`Evolve API escuchando en http://localhost:${config.port}`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`${signal} recibido, cerrando...`);

  const forceExit = setTimeout(() => {
    console.error('Cierre forzado tras 10s');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    try {
      await closePool();
    } finally {
      clearTimeout(forceExit);
      process.exit(0);
    }
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
