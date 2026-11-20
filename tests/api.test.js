'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createApp } = require('../src/app');

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function tempDbFile() {
  return path.join(
    os.tmpdir(),
    `tm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
}

async function startApp(dbFile) {
  const app = createApp({ dbFile });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    app,
    server,
    db: app.locals.db,
    dbFile,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      try {
        app.locals.db.close();
      } catch {
        /* already closed */
      }
    },
  };
}

function readSetCookie(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

/** A tiny browser stand-in: keeps cookies between requests like a real client. */
function makeClient(baseUrl) {
  const jar = new Map();

  return {
    jar,
    async request(pathname, { method = 'GET', body, rawBody, headers = {} } = {}) {
      const sendHeaders = { Accept: 'application/json', ...headers };
      if (jar.size > 0) {
        sendHeaders.Cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      }
      let payload;
      if (body !== undefined) {
        sendHeaders['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      } else if (rawBody !== undefined) {
        sendHeaders['Content-Type'] = 'application/json';
        payload = rawBody;
      }

      const response = await fetch(baseUrl + pathname, {
        method,
        headers: sendHeaders,
        body: payload,
      });

      for (const cookie of readSetCookie(response)) {
        const [pair] = cookie.split(';');
        const index = pair.indexOf('=');
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!value || /Expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(name);
        else jar.set(name, value);
      }

      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      return { status: response.status, data };
    },

    async signup(email, password = 'correct horse battery', name = 'Test User') {
      return this.request('/api/auth/signup', {
        method: 'POST',
        body: { email, password, name },
      });
    },

    async signin(email, password = 'correct horse battery') {
      return this.request('/api/auth/signin', { method: 'POST', body: { email, password } });
    },
  };
}

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

/* ------------------------------------------------------------------ */
/* shared server                                                       */
/* ------------------------------------------------------------------ */

let ctx;

test.before(async () => {
  ctx = await startApp(tempDbFile());
});

test.after(async () => {
  await ctx.stop();
  try {
    fs.rmSync(ctx.dbFile, { force: true });
  } catch {
    /* ignore */
  }
});

/* ------------------------------------------------------------------ */
/* authentication                                                      */
/* ------------------------------------------------------------------ */

test('sign up creates an account, signs the user in and greets them by email', async () => {
  const client = makeClient(ctx.baseUrl);
  const email = uniqueEmail('signup');

  const res = await client.signup(email, 'a-good-password', 'Rupali Choube');
  assert.equal(res.status, 201);
  assert.equal(res.data.user.email, email);
  assert.equal(res.data.user.name, 'Rupali Choube');
  assert.ok(!('password_hash' in res.data.user), 'password hash must never be sent to the browser');
  assert.equal(client.jar.size, 1, 'a session cookie is set');

  const me = await client.request('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, email);
});

test('passwords are stored hashed, never as plain text', async () => {
  const client = makeClient(ctx.baseUrl);
  const email = uniqueEmail('hash');
  const password = 'my-secret-password';

  await client.signup(email, password);
  const row = ctx.db.prepare('SELECT password_hash FROM users WHERE email = ?').get(email);

  assert.ok(row, 'user row exists');
  assert.notEqual(row.password_hash, password);
  assert.match(row.password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
});

test('a duplicate sign up is rejected with a helpful message', async () => {
  const client = makeClient(ctx.baseUrl);
  const email = uniqueEmail('dupe');

  const first = await client.signup(email);
  assert.equal(first.status, 201);

  const second = await makeClient(ctx.baseUrl).signup(email);
  assert.equal(second.status, 409);
  assert.match(second.data.error.message, /already exists/i);
  assert.ok(second.data.error.fields.email);
});

test('sign up validation rejects a bad email and a short password', async () => {
  const client = makeClient(ctx.baseUrl);

  const badEmail = await client.signup('not-an-email', 'a-good-password');
  assert.equal(badEmail.status, 400);
  assert.ok(badEmail.data.error.fields.email);

  const shortPassword = await client.signup(uniqueEmail('short'), 'short');
  assert.equal(shortPassword.status, 400);
  assert.ok(shortPassword.data.error.fields.password);

  const empty = await client.request('/api/auth/signup', { method: 'POST', body: {} });
  assert.equal(empty.status, 400);
  assert.ok(empty.data.error.fields.email);
  assert.ok(empty.data.error.fields.password);
});

test('sign in succeeds with the right password and fails with the wrong one', async () => {
  const email = uniqueEmail('signin');
  const owner = makeClient(ctx.baseUrl);
  await owner.signup(email, 'the-right-password');

  const wrong = await makeClient(ctx.baseUrl).signin(email, 'the-wrong-password');
  assert.equal(wrong.status, 401);
  assert.match(wrong.data.error.message, /incorrect/i);

  const unknown = await makeClient(ctx.baseUrl).signin(uniqueEmail('ghost'), 'whatever-password');
  assert.equal(unknown.status, 401);
  assert.equal(
    unknown.data.error.message,
    wrong.data.error.message,
    'unknown email and wrong password must look the same'
  );

  const good = await makeClient(ctx.baseUrl).signin(email, 'the-right-password');
  assert.equal(good.status, 200);
  assert.equal(good.data.user.email, email);
});

test('sign out ends the session for real', async () => {
  const client = makeClient(ctx.baseUrl);
  await client.signup(uniqueEmail('signout'), 'another-password');

  const before = await client.request('/api/tasks');
  assert.equal(before.status, 200);

  const out = await client.request('/api/auth/signout', { method: 'POST' });
  assert.equal(out.status, 204);

  const after = await client.request('/api/tasks');
  assert.equal(after.status, 401);
});

test('task endpoints refuse requests with no session or a made-up session cookie', async () => {
  const anonymous = await fetch(`${ctx.baseUrl}/api/tasks`);
  assert.equal(anonymous.status, 401);

  const forged = await fetch(`${ctx.baseUrl}/api/tasks`, {
    headers: { Cookie: 'tm_session=this-token-was-never-issued' },
  });
  assert.equal(forged.status, 401);
});

test('an expired session is refused and cleaned up', async () => {
  const client = makeClient(ctx.baseUrl);
  const email = uniqueEmail('expired');
  await client.signup(email, 'expiring-password');

  const ok = await client.request('/api/tasks');
  assert.equal(ok.status, 200);

  // Push the session into the past, as if it had been sitting unused for weeks.
  ctx.db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = (SELECT id FROM users WHERE email = ?)')
    .run(Date.now() - 1000, email);

  const expired = await client.request('/api/tasks');
  assert.equal(expired.status, 401);
  assert.match(expired.data.error.message, /sign in/i);
});

/* ------------------------------------------------------------------ */
/* tasks                                                               */
/* ------------------------------------------------------------------ */

let taskOwner;
let ownerEmail;

test.before(async () => {
  taskOwner = makeClient(ctx.baseUrl);
  ownerEmail = uniqueEmail('owner');
  const res = await taskOwner.signup(ownerEmail, 'owner-password');
  assert.equal(res.status, 201);
});

test('a task can be created and appears in the owner list with its defaults', async () => {
  const res = await taskOwner.request('/api/tasks', {
    method: 'POST',
    body: { title: 'Write the handover notes' },
  });

  assert.equal(res.status, 201);
  assert.equal(res.data.task.title, 'Write the handover notes');
  assert.equal(res.data.task.priority, 'medium');
  assert.equal(res.data.task.status, 'todo');
  assert.equal(res.data.task.description, '');

  const list = await taskOwner.request('/api/tasks');
  assert.equal(list.status, 200);
  assert.ok(list.data.tasks.some((task) => task.id === res.data.task.id));
});

test('task creation validates the title, priority and status', async () => {
  const cases = [
    [{ title: '' }, 'title'],
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(121) }, 'title'],
    [{ title: 'ok title', priority: 'urgent' }, 'priority'],
    [{ title: 'ok title', status: 'archived' }, 'status'],
    [{ title: 'ok title', description: 'y'.repeat(2001) }, 'description'],
  ];

  for (const [body, field] of cases) {
    const res = await taskOwner.request('/api/tasks', { method: 'POST', body });
    assert.equal(res.status, 400, `expected 400 for ${field}`);
    assert.ok(res.data.error.fields[field], `expected an error on ${field}`);
  }

  const empty = await taskOwner.request('/api/tasks', { method: 'POST', body: {} });
  assert.equal(empty.status, 400);
  assert.ok(empty.data.error.fields.title);
});

test('a title at the 120 character limit is accepted', async () => {
  const title = 'T'.repeat(120);
  const res = await taskOwner.request('/api/tasks', { method: 'POST', body: { title } });
  assert.equal(res.status, 201);
  assert.equal(res.data.task.title.length, 120);
});

test('priority and status can be changed at any time', async () => {
  const created = await taskOwner.request('/api/tasks', {
    method: 'POST',
    body: { title: 'Change me', priority: 'low', status: 'todo' },
  });
  const id = created.data.task.id;

  const high = await taskOwner.request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: { priority: 'high' },
  });
  assert.equal(high.status, 200);
  assert.equal(high.data.task.priority, 'high');

  const inProgress = await taskOwner.request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: { status: 'in_progress' },
  });
  assert.equal(inProgress.status, 200);
  assert.equal(inProgress.data.task.status, 'in_progress');
  assert.equal(inProgress.data.task.priority, 'high', 'the earlier change is kept');

  const done = await taskOwner.request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: { status: 'done' },
  });
  assert.equal(done.data.task.status, 'done');

  const low = await taskOwner.request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: { priority: 'low' },
  });
  assert.equal(low.data.task.priority, 'low');

  const bad = await taskOwner.request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: { priority: 'immediate' },
  });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.error.fields.priority);
});

test('a task can be edited and an empty title is refused', async () => {
  const created = await taskOwner.request('/api/tasks', {
    method: 'POST',
    body: { title: 'Old title', description: 'old notes', priority: 'medium', status: 'todo' },
  });
  const id = created.data.task.id;

  const edited = await taskOwner.request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: { title: 'New title', description: 'new notes' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.task.title, 'New title');
  assert.equal(edited.data.task.description, 'new notes');

  const blank = await taskOwner.request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: { title: '   ' },
  });
  assert.equal(blank.status, 400);
  assert.ok(blank.data.error.fields.title);

  const nothing = await taskOwner.request(`/api/tasks/${id}`, { method: 'PATCH', body: {} });
  assert.equal(nothing.status, 400, 'an empty update is refused');

  const stillThere = await taskOwner.request(`/api/tasks/${id}`);
  assert.equal(stillThere.data.task.title, 'New title');
});

test('a task can be deleted, and deleting it again says it is gone', async () => {
  const created = await taskOwner.request('/api/tasks', {
    method: 'POST',
    body: { title: 'Delete me' },
  });
  const id = created.data.task.id;

  const removed = await taskOwner.request(`/api/tasks/${id}`, { method: 'DELETE' });
  assert.equal(removed.status, 204);

  const gone = await taskOwner.request(`/api/tasks/${id}`);
  assert.equal(gone.status, 404);

  const again = await taskOwner.request(`/api/tasks/${id}`, { method: 'DELETE' });
  assert.equal(again.status, 404);
});

test('deleting the last task leaves an empty list, not an error', async () => {
  const client = makeClient(ctx.baseUrl);
  await client.signup(uniqueEmail('lonely'), 'lonely-password');

  const created = await client.request('/api/tasks', {
    method: 'POST',
    body: { title: 'Only task' },
  });
  await client.request(`/api/tasks/${created.data.task.id}`, { method: 'DELETE' });

  const list = await client.request('/api/tasks');
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.tasks, []);
});

test('bad task ids are treated as not found, not as a crash', async () => {
  for (const badId of ['abc', '0', '-3', '1.5', '99999999999999999999999']) {
    const res = await taskOwner.request(`/api/tasks/${badId}`);
    assert.equal(res.status, 404, `id ${badId}`);
  }
});

/* ------------------------------------------------------------------ */
/* privacy between users                                               */
/* ------------------------------------------------------------------ */

test("one user can never read, change or delete another user's task", async () => {
  const alice = makeClient(ctx.baseUrl);
  const bob = makeClient(ctx.baseUrl);
  await alice.signup(uniqueEmail('alice'), 'alice-password');
  await bob.signup(uniqueEmail('bob'), 'bob-password');

  const created = await alice.request('/api/tasks', {
    method: 'POST',
    body: { title: 'Alice private task', priority: 'high', status: 'todo' },
  });
  const id = created.data.task.id;

  const read = await bob.request(`/api/tasks/${id}`);
  assert.equal(read.status, 404, 'guessing the id must not reveal the task');

  const patch = await bob.request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: { title: 'Hijacked', priority: 'low', status: 'done' },
  });
  assert.equal(patch.status, 404);

  const remove = await bob.request(`/api/tasks/${id}`, { method: 'DELETE' });
  assert.equal(remove.status, 404);

  const bobList = await bob.request('/api/tasks');
  assert.equal(bobList.status, 200);
  assert.equal(bobList.data.tasks.length, 0, "Bob's list stays empty");

  const aliceView = await alice.request(`/api/tasks/${id}`);
  assert.equal(aliceView.status, 200);
  assert.equal(aliceView.data.task.title, 'Alice private task');
  assert.equal(aliceView.data.task.priority, 'high');
  assert.equal(aliceView.data.task.status, 'todo');
});

/* ------------------------------------------------------------------ */
/* robustness                                                          */
/* ------------------------------------------------------------------ */

test('a broken JSON body gets a friendly 400 instead of a stack trace', async () => {
  const res = await taskOwner.request('/api/tasks', { method: 'POST', rawBody: '{"title":' });
  assert.equal(res.status, 400);
  assert.match(res.data.error.message, /could not read|check/i);
});

test('an unknown API address answers with friendly JSON', async () => {
  const res = await taskOwner.request('/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.ok(res.data.error.message);
});

test('data and sessions survive a restart of the app', async () => {
  const dbFile = tempDbFile();
  const first = await startApp(dbFile);

  try {
    const client = makeClient(first.baseUrl);
    const email = uniqueEmail('restart');
    assert.equal((await client.signup(email, 'restart-password')).status, 201);
    assert.equal(
      (await client.request('/api/tasks', { method: 'POST', body: { title: 'Survives restart' } }))
        .status,
      201
    );

    // Shut the server and the database file handle down, like stopping the app.
    await new Promise((resolve) => first.server.close(resolve));
    first.app.locals.db.close();

    const second = await startApp(dbFile);
    try {
      // Same browser cookie, new server process: the session was stored, so it still works.
      const reopened = makeClient(second.baseUrl);
      for (const [name, value] of client.jar) reopened.jar.set(name, value);

      const stillSignedIn = await reopened.request('/api/auth/me');
      assert.equal(stillSignedIn.status, 200);
      assert.equal(stillSignedIn.data.user.email, email);

      const list = await reopened.request('/api/tasks');
      assert.equal(list.status, 200);
      assert.equal(list.data.tasks.length, 1);
      assert.equal(list.data.tasks[0].title, 'Survives restart');

      // And signing in again from a clean client works too.
      const fresh = makeClient(second.baseUrl);
      assert.equal((await fresh.signin(email, 'restart-password')).status, 200);
    } finally {
      await second.stop();
    }
  } finally {
    fs.rmSync(dbFile, { force: true });
    fs.rmSync(`${dbFile}-wal`, { force: true });
    fs.rmSync(`${dbFile}-shm`, { force: true });
  }
});
