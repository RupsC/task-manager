'use strict';

/* Task Manager — small single page front end that talks to the app's own API. */

const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };
const STATUS_LABELS = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

const state = {
  user: null,
  tasks: [],
  filter: 'all',
  editingId: null,
  busy: false,
  listLoaded: false,
};

/* ------------------------------ elements ------------------------------ */
const $ = (id) => document.getElementById(id);

const el = {
  alert: $('alert'),
  authView: $('auth-view'),
  appView: $('app-view'),
  account: $('account'),
  accountName: $('account-name'),
  accountAvatar: $('account-avatar'),
  statTotal: $('stat-total'),
  statTodo: $('stat-todo'),
  statProgress: $('stat-progress'),
  statDone: $('stat-done'),
  signoutBtn: $('signout-btn'),
  authHeading: $('auth-heading'),
  authSubtitle: $('auth-subtitle'),
  signinForm: $('signin-form'),
  signupForm: $('signup-form'),
  signinSubmit: $('signin-submit'),
  signupSubmit: $('signup-submit'),
  switchMode: $('switch-mode'),
  switchText: $('switch-text'),
  createForm: $('create-form'),
  createSubmit: $('create-submit'),
  taskList: $('task-list'),
  taskCount: $('task-count'),
  listLoading: $('list-loading'),
  listEmpty: $('list-empty'),
  listFilteredEmpty: $('list-filtered-empty'),
};

let authMode = 'signin';

/* -------------------------------- api -------------------------------- */

async function api(path, options = {}) {
  const opts = {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  };
  if (options.body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(path, opts);
  } catch {
    throw new ApiError(0, 'We could not reach the server. Check your connection and try again.', {});
  }

  let data = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }
  }

  if (!response.ok) {
    const message =
      data && data.error && data.error.message
        ? data.error.message
        : 'Something went wrong. Please try again.';
    const fields = (data && data.error && data.error.fields) || {};
    throw new ApiError(response.status, message, fields);
  }

  return data;
}

class ApiError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

/* ------------------------------ messages ------------------------------ */

let alertTimer = null;

function showAlert(message, kind = 'error') {
  clearTimeout(alertTimer);
  el.alert.textContent = message;
  el.alert.className = `alert is-${kind}`;
  el.alert.hidden = false;
  alertTimer = setTimeout(() => {
    el.alert.hidden = true;
  }, kind === 'error' ? 8000 : 4000);
}

function hideAlert() {
  clearTimeout(alertTimer);
  el.alert.hidden = true;
}

function clearFieldErrors(form) {
  form.querySelectorAll('.field-error').forEach((node) => {
    node.textContent = '';
  });
  form.querySelectorAll('[aria-invalid="true"]').forEach((node) => {
    node.removeAttribute('aria-invalid');
  });
}

function applyFieldErrors(form, fields) {
  Object.entries(fields || {}).forEach(([name, message]) => {
    const errorNode = form.querySelector(`.field-error[data-error-for="${name}"]`);
    if (errorNode) errorNode.textContent = message;
    const input = form.querySelector(`[name="${name}"]`);
    if (input) input.setAttribute('aria-invalid', 'true');
  });
}

function setBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    if (button.dataset.idleLabel) button.textContent = button.dataset.idleLabel;
    button.disabled = false;
  }
}

/* -------------------------------- views ------------------------------- */

function showAuth(message) {
  state.user = null;
  state.tasks = [];
  state.editingId = null;
  el.appView.hidden = true;
  el.authView.hidden = false;
  el.account.hidden = true;
  if (message) showAlert(message, 'error');
}

function showApp(user) {
  state.user = user;
  el.authView.hidden = true;
  el.appView.hidden = false;
  el.account.hidden = false;
  el.accountName.textContent = user.name ? `${user.name} · ${user.email}` : user.email;
  if (el.accountAvatar) el.accountAvatar.textContent = initialsFor(user);
}

/* Two letters for the round avatar: from the name, else from the email. */
function initialsFor(user) {
  const name = (user.name || '').trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0] ? parts[0][0] : '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    const letters = (first + last) || first;
    return letters.toUpperCase();
  }
  const email = (user.email || '').trim();
  return email ? email[0].toUpperCase() : '?';
}

function setAuthMode(mode) {
  authMode = mode;
  const signingIn = mode === 'signin';
  el.signinForm.hidden = !signingIn;
  el.signupForm.hidden = signingIn;
  el.authHeading.textContent = signingIn ? 'Sign in' : 'Create your account';
  el.authSubtitle.textContent = signingIn
    ? 'Welcome back. Sign in to see your tasks.'
    : 'One account keeps your tasks private to you.';
  el.switchText.textContent = signingIn ? 'New here?' : 'Already have an account?';
  el.switchMode.textContent = signingIn ? 'Create an account' : 'Sign in instead';
  clearFieldErrors(el.signinForm);
  clearFieldErrors(el.signupForm);
  hideAlert();
}

/* ------------------------------- tasks -------------------------------- */

function statusOrder(task) {
  return { todo: 0, in_progress: 1, done: 2 }[task.status] ?? 3;
}

function sortTasks(tasks) {
  return tasks.slice().sort((a, b) => {
    const byStatus = statusOrder(a) - statusOrder(b);
    if (byStatus !== 0) return byStatus;
    const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (byPriority !== 0) return byPriority;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function visibleTasks() {
  if (state.filter === 'all') return state.tasks;
  return state.tasks.filter((task) => task.status === state.filter);
}

function badge(text, className) {
  const span = document.createElement('span');
  span.className = `badge ${className}`;
  span.textContent = text;
  return span;
}

function button(label, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn ${className}`;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function selectControl(labelText, options, value, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'control';
  const label = document.createElement('label');
  const id = `sel-${Math.random().toString(36).slice(2, 9)}`;
  label.textContent = labelText;
  label.setAttribute('for', id);
  const select = document.createElement('select');
  select.id = id;
  options.forEach(([optionValue, optionLabel]) => {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = optionLabel;
    if (optionValue === value) option.selected = true;
    select.appendChild(option);
  });
  select.addEventListener('change', () => onChange(select.value, select));
  wrap.append(label, select);
  return wrap;
}

function renderTask(task) {
  const li = document.createElement('li');
  li.className = `task${task.status === 'done' ? ' is-done' : ''}`;
  li.dataset.id = String(task.id);
  li.dataset.priority = task.priority;
  li.dataset.status = task.status;

  if (state.editingId === task.id) {
    li.appendChild(renderEditForm(task));
    return li;
  }

  const top = document.createElement('div');
  top.className = 'task-top';

  const title = document.createElement('h3');
  title.textContent = task.title;

  const badges = document.createElement('div');
  badges.className = 'badges';
  badges.appendChild(badge(PRIORITY_LABELS[task.priority], `badge-priority-${task.priority}`));
  badges.appendChild(badge(STATUS_LABELS[task.status], `badge-status-${task.status}`));

  top.append(title, badges);
  li.appendChild(top);

  if (task.description) {
    const notes = document.createElement('p');
    notes.className = 'task-notes';
    notes.textContent = task.description;
    li.appendChild(notes);
  }

  const controls = document.createElement('div');
  controls.className = 'task-controls';

  controls.appendChild(
    selectControl(
      'Priority',
      Object.entries(PRIORITY_LABELS),
      task.priority,
      (value, select) => updateTask(task, { priority: value }, select)
    )
  );

  controls.appendChild(
    selectControl(
      'Status',
      Object.entries(STATUS_LABELS),
      task.status,
      (value, select) => updateTask(task, { status: value }, select)
    )
  );

  const actions = document.createElement('div');
  actions.className = 'task-actions';
  actions.appendChild(
    button('Edit', 'btn-ghost', () => {
      state.editingId = task.id;
      renderTasks();
    })
  );
  actions.appendChild(button('Delete', 'btn-danger', () => deleteTask(task)));
  controls.appendChild(actions);

  li.appendChild(controls);
  return li;
}

function renderEditForm(task) {
  const form = document.createElement('form');
  form.className = 'edit-form';
  form.noValidate = true;

  const titleLabel = document.createElement('label');
  titleLabel.textContent = 'Title';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.value = task.title;
  titleInput.maxLength = 120;
  titleInput.required = true;
  const titleError = document.createElement('p');
  titleError.className = 'field-error';

  const notesLabel = document.createElement('label');
  notesLabel.textContent = 'Notes';
  const notesInput = document.createElement('textarea');
  notesInput.rows = 2;
  notesInput.maxLength = 2000;
  notesInput.value = task.description || '';
  const notesError = document.createElement('p');
  notesError.className = 'field-error';

  const row = document.createElement('div');
  row.className = 'row';

  const prioritySelect = document.createElement('select');
  Object.entries(PRIORITY_LABELS).forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === task.priority) option.selected = true;
    prioritySelect.appendChild(option);
  });
  const priorityWrap = document.createElement('div');
  priorityWrap.className = 'row-item';
  const priorityLabel = document.createElement('label');
  priorityLabel.textContent = 'Priority';
  priorityWrap.append(priorityLabel, prioritySelect);

  const statusSelect = document.createElement('select');
  Object.entries(STATUS_LABELS).forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === task.status) option.selected = true;
    statusSelect.appendChild(option);
  });
  const statusWrap = document.createElement('div');
  statusWrap.className = 'row-item';
  const statusLabel = document.createElement('label');
  statusLabel.textContent = 'Status';
  statusWrap.append(statusLabel, statusSelect);

  row.append(priorityWrap, statusWrap);

  const actions = document.createElement('div');
  actions.className = 'edit-actions';
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn-primary';
  save.textContent = 'Save changes';
  const cancel = button('Cancel', 'btn-ghost', () => {
    state.editingId = null;
    renderTasks();
  });
  actions.append(save, cancel);

  form.append(titleLabel, titleInput, titleError, notesLabel, notesInput, notesError, row, actions);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    titleError.textContent = '';
    notesError.textContent = '';
    titleInput.removeAttribute('aria-invalid');

    const body = {
      title: titleInput.value.trim(),
      description: notesInput.value.trim(),
      priority: prioritySelect.value,
      status: statusSelect.value,
    };

    if (!body.title) {
      titleError.textContent = 'Title is required.';
      titleInput.setAttribute('aria-invalid', 'true');
      titleInput.focus();
      return;
    }
    if (body.title.length > 120) {
      titleError.textContent = 'Title must be 120 characters or fewer.';
      titleInput.setAttribute('aria-invalid', 'true');
      return;
    }

    setBusy(save, true, 'Saving…');
    try {
      const data = await api(`/api/tasks/${task.id}`, { method: 'PATCH', body });
      state.tasks = state.tasks.map((item) => (item.id === data.task.id ? data.task : item));
      state.editingId = null;
      renderTasks();
      showAlert('Task updated.', 'success');
    } catch (err) {
      setBusy(save, false);
      if (err.status === 401) return handleSessionEnded();
      if (err.status === 404) {
        await refreshTasks();
        showAlert(err.message, 'error');
        return;
      }
      if (err.fields && err.fields.title) titleError.textContent = err.fields.title;
      if (err.fields && err.fields.description) notesError.textContent = err.fields.description;
      showAlert(err.message, 'error');
    }
  });

  titleInput.focus();
  return form;
}

function renderTasks() {
  const tasks = sortTasks(visibleTasks());
  el.taskList.innerHTML = '';

  el.listLoading.hidden = state.listLoaded;
  el.listEmpty.hidden = !(state.listLoaded && state.tasks.length === 0);
  el.listFilteredEmpty.hidden = !(state.listLoaded && state.tasks.length > 0 && tasks.length === 0);

  tasks.forEach((task) => el.taskList.appendChild(renderTask(task)));

  const total = state.tasks.length;
  const counts = { todo: 0, in_progress: 0, done: 0 };
  state.tasks.forEach((task) => {
    if (counts[task.status] !== undefined) counts[task.status] += 1;
  });
  if (el.statTotal) el.statTotal.textContent = String(total);
  if (el.statTodo) el.statTodo.textContent = String(counts.todo);
  if (el.statProgress) el.statProgress.textContent = String(counts.in_progress);
  if (el.statDone) el.statDone.textContent = String(counts.done);

  el.taskCount.textContent = total === 0 ? '' : `${total} task${total === 1 ? '' : 's'}`;
}

async function refreshTasks() {
  try {
    const data = await api('/api/tasks');
    state.tasks = data.tasks;
    state.listLoaded = true;
    renderTasks();
  } catch (err) {
    if (err.status === 401) return handleSessionEnded();
    state.listLoaded = true;
    renderTasks();
    showAlert(err.message, 'error');
  }
}

async function updateTask(task, patch, select) {
  const previous = select ? select.value : null;
  if (select) select.disabled = true;
  try {
    const data = await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: patch });
    state.tasks = state.tasks.map((item) => (item.id === data.task.id ? data.task : item));
    renderTasks();
    const label = patch.status ? 'Status' : 'Priority';
    showAlert(`${label} updated.`, 'success');
  } catch (err) {
    if (select && previous !== null) {
      select.value = previous;
      select.disabled = false;
    }
    if (err.status === 401) return handleSessionEnded();
    if (err.status === 404) await refreshTasks();
    showAlert(err.message, 'error');
  }
}

async function deleteTask(task) {
  const confirmed = window.confirm(`Delete “${task.title}”? This cannot be undone.`);
  if (!confirmed) return;

  try {
    await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
    state.tasks = state.tasks.filter((item) => item.id !== task.id);
    if (state.editingId === task.id) state.editingId = null;
    renderTasks();
    showAlert('Task deleted.', 'success');
  } catch (err) {
    if (err.status === 401) return handleSessionEnded();
    if (err.status === 404) await refreshTasks();
    showAlert(err.message, 'error');
  }
}

function handleSessionEnded() {
  showAuth('Your session has ended. Please sign in again.');
  setAuthMode('signin');
}

/* ------------------------------- events ------------------------------- */

el.switchMode.addEventListener('click', () => {
  setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
});

el.signinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(el.signinForm);

  const email = $('signin-email').value.trim();
  const password = $('signin-password').value;

  const fields = {};
  if (!email) fields.email = 'Email is required.';
  if (!password) fields.password = 'Password is required.';
  if (Object.keys(fields).length > 0) {
    applyFieldErrors(el.signinForm, fields);
    showAlert('Please fill in your email and password.', 'error');
    return;
  }

  setBusy(el.signinSubmit, true, 'Signing in…');
  try {
    const data = await api('/api/auth/signin', { method: 'POST', body: { email, password } });
    el.signinForm.reset();
    showApp(data.user);
    hideAlert();
    state.listLoaded = false;
    await refreshTasks();
  } catch (err) {
    applyFieldErrors(el.signinForm, err.fields);
    showAlert(err.message, 'error');
  } finally {
    setBusy(el.signinSubmit, false);
  }
});

el.signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(el.signupForm);

  const name = $('signup-name').value.trim();
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;

  const fields = {};
  if (!email) fields.email = 'Email is required.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fields.email = 'Enter a valid email address.';
  if (!password) fields.password = 'Password is required.';
  else if (password.length < 8) fields.password = 'Password must be at least 8 characters.';
  if (name.length > 80) fields.name = 'Name is too long.';
  if (Object.keys(fields).length > 0) {
    applyFieldErrors(el.signupForm, fields);
    showAlert('Please check the highlighted fields.', 'error');
    return;
  }

  setBusy(el.signupSubmit, true, 'Creating account…');
  try {
    const data = await api('/api/auth/signup', { method: 'POST', body: { name, email, password } });
    el.signupForm.reset();
    showApp(data.user);
    hideAlert();
    state.listLoaded = false;
    await refreshTasks();
  } catch (err) {
    applyFieldErrors(el.signupForm, err.fields);
    showAlert(err.message, 'error');
  } finally {
    setBusy(el.signupSubmit, false);
  }
});

el.signoutBtn.addEventListener('click', async () => {
  setBusy(el.signoutBtn, true, 'Signing out…');
  try {
    await api('/api/auth/signout', { method: 'POST' });
  } catch {
    /* signing out locally is enough */
  } finally {
    setBusy(el.signoutBtn, false);
    el.createForm.reset();
    $('task-priority').value = 'medium';
    $('task-status').value = 'todo';
    state.filter = 'all';
    document.querySelectorAll('.chip').forEach((chip) => {
      chip.classList.toggle('is-active', chip.dataset.filter === 'all');
    });
    state.listLoaded = false;
    showAuth('You have signed out.');
  }
});

el.createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFieldErrors(el.createForm);

  const body = {
    title: $('task-title').value.trim(),
    description: $('task-description').value.trim(),
    priority: $('task-priority').value,
    status: $('task-status').value,
  };

  const fields = {};
  if (!body.title) fields.title = 'Title is required.';
  else if (body.title.length > 120) fields.title = 'Title must be 120 characters or fewer.';
  if (body.description.length > 2000)
    fields.description = 'Notes must be 2000 characters or fewer.';
  if (Object.keys(fields).length > 0) {
    applyFieldErrors(el.createForm, fields);
    showAlert('Please check the highlighted fields.', 'error');
    return;
  }

  setBusy(el.createSubmit, true, 'Adding…');
  try {
    const data = await api('/api/tasks', { method: 'POST', body });
    state.tasks = [data.task, ...state.tasks];
    state.listLoaded = true;
    $('task-title').value = '';
    $('task-description').value = '';
    $('task-priority').value = 'medium';
    $('task-status').value = 'todo';
    renderTasks();
    showAlert('Task added.', 'success');
    $('task-title').focus();
  } catch (err) {
    applyFieldErrors(el.createForm, err.fields);
    if (err.status === 401) return handleSessionEnded();
    showAlert(err.message, 'error');
  } finally {
    setBusy(el.createSubmit, false);
  }
});

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    state.filter = chip.dataset.filter;
    document.querySelectorAll('.chip').forEach((other) => {
      other.classList.toggle('is-active', other === chip);
    });
    renderTasks();
  });
});

/* -------------------------------- boot -------------------------------- */

async function boot() {
  renderTasks();
  try {
    const data = await api('/api/auth/me');
    showApp(data.user);
    await refreshTasks();
  } catch (err) {
    if (err.status === 401) {
      showAuth(null);
      setAuthMode('signin');
      return;
    }
    showAuth('We could not load the app. Please refresh the page.');
  }
}

boot();
