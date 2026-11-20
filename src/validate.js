'use strict';

/**
 * Shared validation rules. The same rules the browser uses politely are
 * enforced here, because the server must never trust the client.
 */

const PRIORITIES = ['low', 'medium', 'high'];
const STATUSES = ['todo', 'in_progress', 'done'];

const LIMITS = {
  title: 120,
  description: 2000,
  email: 254,
  passwordMin: 8,
  passwordMax: 128,
  name: 80,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function normalizeEmail(value) {
  return asString(value).trim().toLowerCase();
}

function validateCredentials(body, { requireName = false } = {}) {
  const errors = {};
  const data = body && typeof body === 'object' ? body : {};

  const email = normalizeEmail(data.email);
  if (!email) errors.email = 'Email is required.';
  else if (email.length > LIMITS.email) errors.email = 'That email is too long.';
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';

  const password = asString(data.password);
  if (!password) errors.password = 'Password is required.';
  else if (password.length < LIMITS.passwordMin)
    errors.password = `Password must be at least ${LIMITS.passwordMin} characters.`;
  else if (password.length > LIMITS.passwordMax)
    errors.password = `Password must be ${LIMITS.passwordMax} characters or fewer.`;

  const name = asString(data.name).trim();
  if (name.length > LIMITS.name) errors.name = 'Name is too long.';
  if (requireName && !name) errors.name = 'Please tell us your name.';

  return { errors, values: { email, password, name } };
}

function validateTaskCreate(body) {
  const errors = {};
  const data = body && typeof body === 'object' ? body : {};

  const title = asString(data.title).trim();
  if (!title) errors.title = 'Title is required.';
  else if (title.length > LIMITS.title)
    errors.title = `Title must be ${LIMITS.title} characters or fewer.`;

  const description = asString(data.description).trim();
  if (description.length > LIMITS.description)
    errors.description = `Description must be ${LIMITS.description} characters or fewer.`;

  const priority = asString(data.priority) || 'medium';
  if (!PRIORITIES.includes(priority))
    errors.priority = 'Priority must be low, medium or high.';

  const status = asString(data.status) || 'todo';
  if (!STATUSES.includes(status))
    errors.status = 'Status must be todo, in progress or done.';

  return { errors, values: { title, description, priority, status } };
}

function validateTaskUpdate(body) {
  const errors = {};
  const data = body && typeof body === 'object' ? body : {};
  const values = {};

  if (Object.prototype.hasOwnProperty.call(data, 'title')) {
    const title = asString(data.title).trim();
    if (!title) errors.title = 'Title is required.';
    else if (title.length > LIMITS.title)
      errors.title = `Title must be ${LIMITS.title} characters or fewer.`;
    else values.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'description')) {
    const description = asString(data.description).trim();
    if (description.length > LIMITS.description)
      errors.description = `Description must be ${LIMITS.description} characters or fewer.`;
    else values.description = description;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'priority')) {
    const priority = asString(data.priority);
    if (!PRIORITIES.includes(priority))
      errors.priority = 'Priority must be low, medium or high.';
    else values.priority = priority;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'status')) {
    const status = asString(data.status);
    if (!STATUSES.includes(status))
      errors.status = 'Status must be todo, in progress or done.';
    else values.status = status;
  }

  if (Object.keys(values).length === 0 && Object.keys(errors).length === 0) {
    errors.form = 'Nothing to update. Change a title, priority or status first.';
  }

  return { errors, values };
}

module.exports = {
  PRIORITIES,
  STATUSES,
  LIMITS,
  validateCredentials,
  validateTaskCreate,
  validateTaskUpdate,
  normalizeEmail,
};
