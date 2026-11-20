'use strict';

const express = require('express');
const {
  validateCredentials,
  validateTaskCreate,
  validateTaskUpdate,
  PRIORITIES,
  STATUSES,
} = require('../validate');

function serializeTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function serializeUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function badRequest(res, errors) {
  return res.status(400).json({
    error: { message: 'Please check the highlighted fields.', fields: errors },
  });
}

/**
 * Task endpoints. `selectOwned` is the only way a task row is ever loaded, so
 * a task belonging to somebody else simply does not exist as far as this API
 * is concerned: it answers 404 instead of leaking that the id is real.
 */
function taskRoutes(db) {
  const router = express.Router();

  const selectOwned = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?');

  function parseId(raw) {
    if (!/^[0-9]+$/.test(String(raw))) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function notFound(res) {
    return res.status(404).json({
      error: { message: "We couldn't find that task. It may have been deleted." },
    });
  }

  router.get('/', (req, res) => {
    const rows = db
      .prepare(
        `SELECT * FROM tasks
          WHERE user_id = ?
          ORDER BY created_at DESC, id DESC`
      )
      .all(req.user.id);
    res.json({ tasks: rows.map(serializeTask) });
  });

  router.post('/', (req, res) => {
    const { errors, values } = validateTaskCreate(req.body);
    if (Object.keys(errors).length > 0) return badRequest(res, errors);

    const now = Date.now();
    const info = db
      .prepare(
        `INSERT INTO tasks (user_id, title, description, priority, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(req.user.id, values.title, values.description, values.priority, values.status, now, now);

    const row = selectOwned.get(info.lastInsertRowid, req.user.id);
    res.status(201).json({ task: serializeTask(row) });
  });

  router.get('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return notFound(res);
    const row = selectOwned.get(id, req.user.id);
    if (!row) return notFound(res);
    res.json({ task: serializeTask(row) });
  });

  router.patch('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return notFound(res);
    const row = selectOwned.get(id, req.user.id);
    if (!row) return notFound(res);

    const { errors, values } = validateTaskUpdate(req.body);
    if (Object.keys(errors).length > 0) return badRequest(res, errors);

    const next = {
      title: values.title !== undefined ? values.title : row.title,
      description: values.description !== undefined ? values.description : row.description,
      priority: values.priority !== undefined ? values.priority : row.priority,
      status: values.status !== undefined ? values.status : row.status,
    };

    db.prepare(
      `UPDATE tasks
          SET title = ?, description = ?, priority = ?, status = ?, updated_at = ?
        WHERE id = ? AND user_id = ?`
    ).run(next.title, next.description, next.priority, next.status, Date.now(), id, req.user.id);

    res.json({ task: serializeTask(selectOwned.get(id, req.user.id)) });
  });

  router.delete('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return notFound(res);
    const row = selectOwned.get(id, req.user.id);
    if (!row) return notFound(res);
    db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(id, req.user.id);
    res.status(204).end();
  });

  return router;
}

module.exports = { taskRoutes, serializeTask, serializeUser, PRIORITIES, STATUSES };
