'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'tm_session';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);
const DAY_MS = 24 * 60 * 60 * 1000;
const SCRYPT_KEY_LENGTH = 64;

/* ------------------------------------------------------------------ */
/* Passwords: salted scrypt hashes, never stored in plain text.        */
/* ------------------------------------------------------------------ */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  let expected;
  try {
    expected = Buffer.from(expectedHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEY_LENGTH) return false;
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return crypto.timingSafeEqual(actual, expected);
}

/* ------------------------------------------------------------------ */
/* Sessions: random token in an httpOnly cookie, hash kept in the DB.  */
/* ------------------------------------------------------------------ */

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * DAY_MS;
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(hashToken(token), userId, now, expiresAt);
  return { token, expiresAt };
}

function findSessionUser(db, token) {
  if (!token || typeof token !== 'string') return null;
  const row = db
    .prepare(
      `SELECT s.token_hash, s.expires_at, u.id, u.email, u.name, u.created_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
    )
    .get(hashToken(token));
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
}

function destroySession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function deleteExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const piece of header.split(';')) {
    const index = piece.indexOf('=');
    if (index < 0) continue;
    const key = piece.slice(0, index).trim();
    const value = piece.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  };
}

function setSessionCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), expires: new Date(expiresAt) });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

function getSessionToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] || null;
}

/** Middleware: every task request passes through this real session check. */
function requireAuth(db) {
  return function authMiddleware(req, res, next) {
    const token = getSessionToken(req);
    const user = findSessionUser(db, token);
    if (!user) {
      return res.status(401).json({
        error: { message: 'You are not signed in. Please sign in to continue.' },
      });
    }
    req.user = user;
    req.sessionToken = token;
    next();
  };
}

module.exports = {
  COOKIE_NAME,
  SESSION_DAYS,
  hashPassword,
  verifyPassword,
  createSession,
  findSessionUser,
  destroySession,
  deleteExpiredSessions,
  getSessionToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
};
