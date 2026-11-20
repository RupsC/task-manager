# Task Manager

A small, self-contained task management web app: each person signs up, signs in, and keeps
their **own** private list of tasks with a priority (Low / Medium / High) and a status
(To do / In progress / Done).

It is one coherent app: the browser page is served by the same Node server that provides the
API it talks to. No mock data — everything is read from and written to a real database file.

## What it does

- **Accounts:** sign up, sign in, sign out. Passwords are stored as salted scrypt hashes,
  never in plain text. A random session token is kept in an HttpOnly cookie and checked
  against the database on *every* task request (not just hidden in the page).
- **Privacy:** every task query is scoped to the signed-in user. Another user's task id
  answers "not found" instead of revealing or changing it.
- **Tasks:** create, edit, delete; change priority and status at any time. The list shows
  badges for both, plus a filter by status and a count.
- **Validation:** on both sides — required title, length limits, valid priority/status,
  duplicate sign-up rejected, wrong password rejected.
- **Error handling:** friendly messages instead of blank screens or stack traces; loading
  states and empty states ("No tasks yet", "Nothing here with that status").
- **Responsive:** works down to a 320 px phone screen without sideways scrolling.

## Tech, and why

- **Node.js + Express** — one small server, no build step, runs anywhere Node 18+ runs.
- **SQLite** (via `better-sqlite3`) — the whole database is one file (`data/task-manager.db`),
  so data survives a restart and there is nothing to install or pay for.
- **Plain HTML, CSS and JavaScript** for the front end — no framework, no bundler, so the
  app stays small and reproducible.
- **Tests** with Node's built-in test runner (`node --test`) — no extra test dependency.

## Run it locally

```bash
npm install          # install dependencies
cp .env.example .env # optional: change the port, database path or session length
npm start            # http://localhost:3000
```

Then open <http://localhost:3000>, choose **Create an account**, and add a task.

Optional: `npm run seed` creates a made-up demo account (`demo@example.test` /
`demo-pass-1234`) with a few tasks — for local looking-around only.

Stop the app with **Ctrl+C**. Start it again and your account and tasks are still there.

### Configuration

All settings are environment variables; nothing secret is in the code. `.env.example` lists the
placeholders — copy it to `.env` (which is git-ignored):

| Variable       | Default                 | Meaning                                     |
| -------------- | ----------------------- | ------------------------------------------- |
| `PORT`         | `3000`                  | Port to listen on                           |
| `DB_FILE`      | `data/task-manager.db`  | SQLite database file (created automatically)|
| `SESSION_DAYS` | `7`                     | How long a sign-in lasts                    |
| `NODE_ENV`     | `development`           | `production` marks the session cookie secure |

## Tests

```bash
npm test
```

Covers sign-up, sign-in, sign-out, session expiry, task create / edit / delete, priority and
status changes, validation failures and the access check that one user cannot read, change or
delete another user's task. Tests run against a temporary database, so they never touch your
own data.

## API endpoints

All task endpoints require a valid session cookie (`tm_session`), otherwise they answer `401`.

| Method   | Path                | Purpose                              |
| -------- | ------------------- | ------------------------------------ |
| `POST`   | `/api/auth/signup`  | Create an account (`email`, `password`, `name`) and sign in |
| `POST`   | `/api/auth/signin`  | Sign in (`email`, `password`)        |
| `POST`   | `/api/auth/signout` | Sign out and end the session         |
| `GET`    | `/api/auth/me`      | The signed-in user (`401` if not signed in) |
| `GET`    | `/api/health`       | Health check                         |
| `GET`    | `/api/tasks`        | List my tasks                        |
| `POST`   | `/api/tasks`        | Create a task (`title`, `description`, `priority`, `status`) |
| `GET`    | `/api/tasks/:id`    | Read one of my tasks                 |
| `PATCH`  | `/api/tasks/:id`    | Update any of `title`, `description`, `priority`, `status` |
| `DELETE` | `/api/tasks/:id`    | Delete one of my tasks               |

`priority` is `low` \| `medium` \| `high`; `status` is `todo` \| `in_progress` \| `done`.

Errors come back as JSON in one shape, with a friendly message and, for form problems, which
field is wrong:

```json
{ "error": { "message": "Please check the highlighted fields.", "fields": { "title": "Title is required." } } }
```

## Not included (deliberately)

No email verification, password reset, sharing tasks with other people, or hosted deployment.
This is a small app built to be read, run and tested locally.
