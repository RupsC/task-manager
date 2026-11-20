'use strict';

const path = require('path');
const { loadEnv } = require('./src/env');

loadEnv(path.join(__dirname, '.env'));

const { createApp } = require('./src/app');

const port = Number(process.env.PORT || 3000);
const app = createApp();

const server = app.listen(port, () => {
  const dbFile = process.env.DB_FILE || 'data/task-manager.db (default)';
  console.log(`Task Manager is running at http://localhost:${port}`);
  console.log(`Data file: ${dbFile}`);
});

function shutdown() {
  server.close(() => {
    try {
      app.locals.db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
