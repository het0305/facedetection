// Entry point: validate config -> connect DB -> migrate -> load models -> listen.
let config;
try {
  config = require('./src/config');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const logger = require('./src/utils/logger');
const db = require('./src/db');
const { runMigrations } = require('./src/migrations');
const { createApp } = require('./src/app');
const faceEngine = require('./src/services/faceEngine');
const liveness = require('./src/services/liveness');
const gallery = require('./src/services/gallery');
const Admin = require('./src/models/Admin');

async function main() {
  await db.connect();
  logger.info('MongoDB connected');
  await runMigrations();
  await Promise.all([faceEngine.init(), liveness.init()]);
  await gallery.load();
  if (!(await Admin.exists({}))) {
    logger.warn('No admin account exists yet. Create one with: npm run create-admin');
  }
  const server = createApp().listen(config.PORT, () => logger.info('Server listening', { port: config.PORT }));

  const shutdown = (signal) => {
    logger.info('Shutting down', { signal });
    server.close(() => db.disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

process.on('unhandledRejection', (err) => logger.error('Unhandled rejection', { err }));

main().catch((err) => {
  logger.error('Startup failed', { err });
  console.error(`Startup failed: ${err.message}`);
  process.exit(1);
});
