'use strict';

/**
 * Optional: adds a made-up demo account with a few tasks so you can look around
 * without typing anything. Run it with:  node scripts/seed-demo.js
 *
 * The credentials are deliberately fake and only work on your own machine.
 */

const path = require('path');
const { loadEnv } = require('../src/env');

loadEnv(path.join(__dirname, '..', '.env'));

const { createDatabase } = require('../src/db');
const { hashPassword } = require('../src/auth');

const DEMO_EMAIL = process.env.DEMO_EMAIL || 'demo@example.test';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo-pass-1234';

const dbFile =
  process.env.DB_FILE || path.join(__dirname, '..', 'data', 'task-manager.db');

const db = createDatabase(dbFile);

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL);
let userId;
if (existing) {
  userId = existing.id;
  console.log(`Demo account already exists: ${DEMO_EMAIL}`);
} else {
  const info = db
    .prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(DEMO_EMAIL, 'Demo User', hashPassword(DEMO_PASSWORD), Date.now());
  userId = info.lastInsertRowid;
  console.log(`Created demo account: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

const count = db.prepare('SELECT COUNT(*) AS c FROM tasks WHERE user_id = ?').get(userId).c;
if (count === 0) {
  const insert = db.prepare(
    `INSERT INTO tasks (user_id, title, description, priority, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const now = Date.now();
  const demo = [
    ['Finish the project brief', 'Send the first draft to the team for comments.', 'high', 'in_progress'],
    ['Book the dentist appointment', '', 'medium', 'todo'],
    ['Water the plants', '', 'low', 'done'],
  ];
  demo.forEach(([title, description, priority, status], index) => {
    insert.run(userId, title, description, priority, status, now - index * 1000, now - index * 1000);
  });
  console.log(`Added ${demo.length} demo tasks.`);
} else {
  console.log('Demo tasks already present, nothing to do.');
}

db.close();
