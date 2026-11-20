'use strict';

const express = require('express');
const {
  createSession,
  destroySession,
  findSessionUser,
  getSessionToken,
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
} = require('../auth');
const { validateCredentials, normalizeEmail } = require('../validate');
const { serializeUser } = require('./tasks');

function authRoutes(db) {
  const router = express.Router();

  const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const insertUser = db.prepare(
    'INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)'
  );

  router.post('/signup', (req, res) => {
    const { errors, values } = validateCredentials(req.body);
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        error: { message: 'Please check the highlighted fields.', fields: errors },
      });
    }

    if (findByEmail.get(values.email)) {
      return res.status(409).json({
        error: {
          message: 'An account with that email already exists. Try signing in instead.',
          fields: { email: 'This email is already registered.' },
        },
      });
    }

    let info;
    try {
      info = insertUser.run(values.email, values.name, hashPassword(values.password), Date.now());
    } catch (err) {
      // The unique index caught a duplicate sign-up that slipped past the check.
      if (String(err.code).startsWith('SQLITE_CONSTRAINT')) {
        return res.status(409).json({
          error: {
            message: 'An account with that email already exists. Try signing in instead.',
            fields: { email: 'This email is already registered.' },
          },
        });
      }
      throw err;
    }

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    const session = createSession(db, row.id);
    setSessionCookie(res, session.token, session.expiresAt);
    res.status(201).json({ user: serializeUser(row) });
  });

  router.post('/signin', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';

    const fields = {};
    if (!email) fields.email = 'Email is required.';
    if (!password) fields.password = 'Password is required.';
    if (Object.keys(fields).length > 0) {
      return res
        .status(400)
        .json({ error: { message: 'Please check the highlighted fields.', fields } });
    }

    const user = findByEmail.get(email);
    // Same answer for "no such account" and "wrong password".
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: { message: 'Email or password is incorrect.' } });
    }

    const session = createSession(db, user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ user: serializeUser(user) });
  });

  router.post('/signout', (req, res) => {
    destroySession(db, getSessionToken(req));
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get('/me', (req, res) => {
    const user = findSessionUser(db, getSessionToken(req));
    if (!user) {
      return res
        .status(401)
        .json({ error: { message: 'You are not signed in. Please sign in to continue.' } });
    }
    res.json({ user });
  });

  return router;
}

module.exports = { authRoutes };
