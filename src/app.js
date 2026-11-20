'use strict';

const path = require('path');
const express = require('express');
const { createDatabase } = require('./db');
const { authRoutes } = require('./routes/auth');
const { taskRoutes } = require('./routes/tasks');
const { requireAuth, deleteExpiredSessions } = require('./auth');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; form-action 'self'; base-uri 'none'"
  );
  next();
}

function createApp(options = {}) {
  const dbFile =
    options.dbFile || process.env.DB_FILE || path.join(ROOT, 'data', 'task-manager.db');

  const db = createDatabase(dbFile);
  deleteExpiredSessions(db);

  const app = express();
  app.locals.db = db;
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes(db));
  app.use('/api/tasks', requireAuth(db), taskRoutes(db));

  // Unknown API path: friendly JSON instead of an HTML error page.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: { message: 'That address does not exist in this app.' } });
  });

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: 0 }));

  // Anything else that is not the API gets the single page app shell.
  app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const isApi = req.path.startsWith('/api');

    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
      if (isApi) {
        return res
          .status(400)
          .json({ error: { message: 'We could not read that request. Please try again.' } });
      }
      return res.status(400).send('Bad request');
    }

    if (err && err.type === 'entity.too.large') {
      if (isApi) {
        return res.status(413).json({ error: { message: 'That is too much text to save.' } });
      }
      return res.status(413).send('Too large');
    }

    console.error('Unhandled error:', err && err.message ? err.message : err);

    if (isApi) {
      return res.status(500).json({
        error: { message: 'Something went wrong on our side. Please try again.' },
      });
    }
    return res.status(500).send('Something went wrong on our side.');
  });

  return app;
}

module.exports = { createApp, PUBLIC_DIR };
