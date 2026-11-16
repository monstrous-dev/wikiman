// Generates the acme-ops fixture project — a representative complex monorepo
// with deliberate wayfinding traps (twin cache modules, spread-out config).
// Re-runnable: deletes and regenerates the target dir.
import { rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";

const ROOT = "C:\\Users\\PTW\\wikiman-e2e\\acme-ops";

const F = {
  "README.md": `# acme-ops

Internal task-operations platform. Monorepo (npm workspaces).

- services/api — Express REST API (Postgres via pg pool, Redis cache, JWT auth)
- services/worker — BullMQ consumer (email, search reindex, webhooks)
- apps/web — React SPA (Zustand store, REST client)
- packages/shared — types, events, validation, browser cache
- infra — nginx, grafana dashboard

Quick start: docker compose up; npm -w services/api dev; npm -w services/worker dev.
Conventions live in docs/adr/. Smoke test: scripts/smoke.sh.
`,
  "package.json": `{
  "name": "acme-ops",
  "private": true,
  "workspaces": ["services/*", "apps/*", "packages/*"],
  "scripts": { "dev:api": "npm -w services/api run dev", "dev:worker": "npm -w services/worker run dev", "seed": "node scripts/seed.ts" }
}
`,
  "docker-compose.yml": `services:
  postgres: { image: postgres:16, ports: ["5432:5432"], environment: { POSTGRES_PASSWORD: dev } }
  redis: { image: redis:7, ports: ["6379:6379"] }
  api: { build: ./services/api, ports: ["8080:8080"], depends_on: [postgres, redis] }
  worker: { build: ./services/worker, depends_on: [redis] }
`,
  ".env.example": `DATABASE_URL=postgres://postgres:dev@localhost:5432/acme
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
`,
  "docs/adr/0001-postgres-over-mongo.md": `# ADR 1: Postgres over MongoDB

Date: 2026-09-02. Status: accepted.
We chose Postgres: task state is relational (task -> user -> project), we need
transactions for assignment flows. Mongo was rejected (no joins, team knows pg).
Pool: services/api/src/db/pool.ts (pg, max 10). Migrations in db/migrations.
`,
  "docs/adr/0002-bullmq-for-job-queue.md": `# ADR 2: BullMQ for the job queue

Date: 2026-09-20. Status: accepted.
BullMQ on Redis for async work (email, reindex, webhooks). API enqueues,
services/worker consumes. Dead letters go to queues/dlq.ts after 3 attempts.
Producers MUST enqueue inside the same Postgres transaction as the write
(outbox pattern, see services/api/src/routes/tasks.ts).
`,
  "docs/adr/0003-zustand-for-web-state.md": `# ADR 3: Zustand for web state

Date: 2026-10-05. Status: accepted.
apps/web uses Zustand (state/store.ts) over Redux: smaller, no boilerplate.
Server state stays out of the store: components fetch via api/client.ts with
stale-while-revalidate; only session + optimistic task edits live in Zustand.
`,
  "docs/wiki/index.md": `---
okf_version: "0.1"
---

# acme-ops Knowledge Wiki

- [Overview](./overview.md) — architecture and subsystems
- [Glossary](./glossary.md) — key terms
- [Learnings](./learnings/) — captured gotchas
`,
  "docs/wiki/overview.md": `---
type: System Overview
title: Overview
description: acme-ops architecture.
timestamp: "2026-10-01T09:00:00.000Z"
---

# Overview

acme-ops is a task-operations platform in four workspaces. services/api is the
Express REST API: routes/tasks.ts and routes/users.ts own the business logic,
middleware/auth.ts verifies JWTs, middleware/ratelimit.ts throttles per token
bucket in Redis. Persistence is Postgres through db/pool.ts.

services/worker consumes BullMQ jobs from Redis: sendEmail, reindex (search),
webhooks. Dead-lettered jobs land in queues/dlq.ts after 3 attempts.

apps/web is a React SPA; server state is fetched by api/client.ts, session and
optimistic edits live in the Zustand store (state/store.ts).

packages/shared has types, events, validation — and TWO different cache
modules: packages/shared/src/cache.ts is a browser-side LRU for the SPA;
services/api/src/cache.ts is the Redis-backed server cache. They are NOT
interchangeable.
`,
  "docs/wiki/glossary.md": `---
type: Glossary
title: Glossary
description: acme-ops terms.
timestamp: "2026-10-01T09:00:00.000Z"
---

# Glossary

| Term | Definition |
|------|------------|
| task | The core entity; see packages/shared/src/types/task.ts |
| DLQ | Dead-letter queue for failed BullMQ jobs (worker/queues/dlq.ts) |
| outbox | Enqueue jobs in the same pg transaction as the write (ADR 2) |
`,
  "docs/wiki/last_updated.md": `# Last wiki sync

2026-11-16T09:00:00.000Z
`,
  "docs/wiki/log.md": `# Update Log

## 2026-10-01
- **Creation**: Initial bundle.
`,
  "docs/wiki/learnings/ratelimit-uses-redis-sliding-window.md": `---
type: Learning
title: Rate limit is a Redis sliding window keyed by userId
description: Where the throttle lives and how it is keyed.
timestamp: "2026-10-01T09:05:00.000Z"
resource: services/api/src/middleware/ratelimit.ts
---

Rate limiting (middleware/ratelimit.ts) is a sliding window in Redis, keyed by
authenticated userId — NOT by IP. Unauthenticated requests bypass it entirely.
Window and max come from env RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX.
`,
  "docs/wiki/learnings/two-cache-modules-never-mix-them.md": `---
type: Learning
title: Two cache modules — never mix them
description: services/api/src/cache.ts (Redis) vs packages/shared/src/cache.ts (browser LRU).
timestamp: "2026-10-01T09:06:00.000Z"
resource: packages/shared/src/cache.ts
---

There are two cache.ts files. services/api/src/cache.ts is the SERVER cache:
Redis, JSON-serializable values, 30s TTL, used by routes for hot reads.
packages/shared/src/cache.ts is a BROWSER LRU (Map-based, 50 entries) used only
by apps/web. Never import the shared one from a service — it holds no Redis
connection and silently no-ops. New server-side caching goes in the api one.
`,
  "services/api/package.json": `{ "name": "@acme/api", "type": "module", "scripts": { "dev": "tsx watch src/index.ts" }, "dependencies": { "express": "^4", "pg": "^8", "ioredis": "^5", "bullmq": "^5", "jsonwebtoken": "^9" } }
`,
  "services/api/tsconfig.json": `{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "strict": true, "moduleResolution": "bundler" } }
`,
  "services/api/src/index.ts": `import express from "express";
import { config } from "./config.js";
import { tasksRouter } from "./routes/tasks.js";
import { usersRouter } from "./routes/users.js";
import { healthRouter } from "./routes/health.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();
app.use(express.json());
app.use("/tasks", tasksRouter);
app.use("/users", usersRouter);
app.use("/health", healthRouter);
app.use(errorHandler);
app.listen(config.port, () => console.log("api on " + config.port));
`,
  "services/api/src/config.ts": `// Single source of truth for env config. Do not read process.env elsewhere.
export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: requireEnv("DATABASE_URL"),
  redisUrl: requireEnv("REDIS_URL"),
  jwtSecret: requireEnv("JWT_SECRET"),
  rateWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000),
  rateMax: Number(process.env.RATE_LIMIT_MAX ?? 120),
};
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error("missing env " + name);
  return v;
}
`,
  "services/api/src/routes/tasks.ts": `import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { redisCache } from "../cache.js";
import { tasksQueue } from "../../../services/worker/src/queues/tasks.js";
import { validateTask } from "../../../packages/shared/src/validation.js";

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

tasksRouter.get("/:id", async (req, res, next) => {
  try {
    const hit = await redisCache.get("task:" + req.params.id);
    if (hit) return res.json(hit);
    const { rows } = await pool.query("select * from tasks where id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    await redisCache.set("task:" + req.params.id, rows[0]);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

tasksRouter.post("/", async (req, res, next) => {
  try {
    const t = validateTask(req.body);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(
        "insert into tasks (title, status, user_id) values ($1,$2,$3) returning *",
        [t.title, "open", t.userId]);
      await tasksQueue.add("task-created", { taskId: rows[0].id }); // outbox: same tx
      await client.query("commit");
      res.status(201).json(rows[0]);
    } finally { client.release(); }
  } catch (e) { next(e); }
});
`,
  "services/api/src/routes/users.ts": `import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get("/me", async (req, res, next) => {
  try {
    const { rows } = await pool.query("select id, email, display_name from users where id = $1", [(req as any).userId]);
    res.json(rows[0] ?? null);
  } catch (e) { next(e); }
});
`,
  "services/api/src/routes/health.ts": `import { Router } from "express";
import { pool } from "../db/pool.js";

export const healthRouter = Router();
healthRouter.get("/", async (_req, res) => {
  const pg = await pool.query("select 1").then(() => "up").catch(() => "down");
  res.json({ status: pg === "up" ? "ok" : "degraded", pg });
});
`,
  "services/api/src/middleware/auth.ts": `import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "no token" });
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as { sub: string };
    (req as any).userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "bad token" });
  }
}
`,
  "services/api/src/middleware/ratelimit.ts": `import type { NextFunction, Request, Response } from "express";
import { redisCache } from "../cache.js";
import { config } from "../config.js";

// Sliding window in Redis, keyed by AUTHENTICATED userId (never by IP).
// Unauthenticated requests pass through untouched. See wiki learning.
export async function rateLimit(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).userId as string | undefined;
  if (!userId) return next();
  const key = "rl:" + userId;
  const count = await redisCache.incrWindow(key, config.rateWindowMs);
  if (count > config.rateMax) return res.status(429).json({ error: "rate limited" });
  next();
}
`,
  "services/api/src/middleware/errorHandler.ts": `import type { NextFunction, Request, Response } from "express";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error(err);
  res.status(500).json({ error: "internal" });
}
`,
  "services/api/src/db/pool.ts": `import { Pool } from "pg";
import { config } from "../config.js";

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
`,
  "services/api/src/db/migrate.ts": `import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
for (const f of readdirSync(dir).sort()) {
  await pool.query(readFileSync(join(dir, f), "utf8"));
  console.log("applied", f);
}
process.exit(0);
`,
  "services/api/src/db/migrations/001_init.sql": `create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  created_at timestamptz default now()
);
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'open',
  user_id uuid references users(id),
  created_at timestamptz default now()
);
`,
  "services/api/src/cache.ts": `// SERVER cache — Redis-backed. The browser LRU lives in packages/shared;
// do not confuse the two (see wiki learning 'two-cache-modules').
import Redis from "ioredis";
import { config } from "./config.js";

const redis = new Redis(config.redisUrl);
const TTL_SECONDS = 30;

export const redisCache = {
  async get<T>(key: string): Promise<T | null> {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  async set(key: string, value: unknown): Promise<void> {
    await redis.set(key, JSON.stringify(value), "EX", TTL_SECONDS);
  },
  async incrWindow(key: string, windowMs: number): Promise<number> {
    const n = await redis.incr(key);
    if (n === 1) await redis.pexpire(key, windowMs);
    return n;
  },
};
`,
  "services/api/src/utils/ids.ts": `// API-side id helpers (uuid v4). Sorting/comparison helpers live in shared/validation.
import { randomUUID } from "node:crypto";
export const newId = (): string => randomUUID();
`,
  "services/worker/package.json": `{ "name": "@acme/worker", "type": "module", "scripts": { "dev": "tsx watch src/index.ts" }, "dependencies": { "bullmq": "^5", "ioredis": "^5", "nodemailer": "^6" } }
`,
  "services/worker/src/index.ts": `import { taskWorker } from "./queues/tasks.js";
import { startDlqSweeper } from "./queues/dlq.js";

taskWorker.run();
startDlqSweeper();
console.log("worker up");
`,
  "services/worker/src/queues/tasks.ts": `import { Worker, Queue } from "bullmq";
import { sendEmail } from "../handlers/sendEmail.js";
import { reindex } from "../handlers/reindex.js";
import { deliverWebhook } from "../handlers/webhooks.js";

export const connection = { host: process.env.REDIS_HOST ?? "localhost", port: 6379 };
export const tasksQueue = new Queue("tasks", { connection });

const handlers: Record<string, (data: any) => Promise<void>> = {
  "task-created": (d) => deliverWebhook(d),
  "task-assigned": (d) => sendEmail(d),
  "reindex": (d) => reindex(d),
};

export const taskWorker = new Worker("tasks", async (job) => {
  const h = handlers[job.name];
  if (!h) throw new Error("no handler for " + job.name);
  await h(job.data);
}, { connection, attempts: 3, backoff: { type: "exponential", delay: 1000 } });
`,
  "services/worker/src/queues/dlq.ts": `import { Queue } from "bullmq";
import { connection } from "./tasks.js";

// Failed-after-3-attempts jobs land here (ADR 2). Sweeper logs + alerts.
export const dlq = new Queue("tasks-dlq", { connection });

export function startDlqSweeper() {
  setInterval(async () => {
    const failed = await dlq.getJobs(["failed"], 0, 20);
    for (const j of failed) console.error("DLQ:", j.id, j.name, j.failedReason);
  }, 60_000);
}
`,
  "services/worker/src/handlers/sendEmail.ts": `import nodemailer from "nodemailer";

export async function sendEmail(data: { email: string; taskId: string }) {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  await transport.sendMail({ to: data.email, subject: "Task assigned", text: "task " + data.taskId });
}
`,
  "services/worker/src/handlers/reindex.ts": `// Pushes tasks into the search index. Batch of 100 per call to avoid hot loops.
export async function reindex(data: { taskIds: string[] }) {
  for (let i = 0; i < data.taskIds.length; i += 100) {
    const batch = data.taskIds.slice(i, i + 100);
    console.log("indexing", batch.length, "tasks");
  }
}
`,
  "services/worker/src/handlers/webhooks.ts": `import { pool } from "../../api/src/db/pool.js";

export async function deliverWebhook(data: { taskId: string }) {
  const { rows } = await pool.query("select * from tasks where id = $1", [data.taskId]);
  if (!rows[0]) return;
  console.log("webhook for task", rows[0].id);
}
`,
  "apps/web/package.json": `{ "name": "@acme/web", "type": "module", "scripts": { "dev": "vite" }, "dependencies": { "react": "^18", "zustand": "^4" }, "devDependencies": { "vite": "^5" } }
`,
  "apps/web/index.html": `<!doctype html>
<html><head><meta charset="utf-8" /><title>acme-ops</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
`,
  "apps/web/src/main.tsx": `import { createRoot } from "react-dom/client";
import { App } from "./App.js";
createRoot(document.getElementById("root")!).render(<App />);
`,
  "apps/web/src/App.tsx": `import { Header } from "./components/Header.js";
import { TaskList } from "./components/TaskList.js";
import { TaskDetail } from "./components/TaskDetail.js";

export function App() {
  return (
    <div>
      <Header />
      <main><TaskList /><TaskDetail /></main>
    </div>
  );
}
`,
  "apps/web/src/api/client.ts": `// Server state fetches with stale-while-revalidate. Session/optimistic state goes
// to the Zustand store instead. Uses the browser LRU from packages/shared.
import { lru } from "../../../packages/shared/src/cache.js";

export async function fetchTask(id: string) {
  const hit = lru.get("task:" + id);
  if (hit) return hit;
  const res = await fetch("/api/tasks/" + id);
  const json = await res.json();
  lru.set("task:" + id, json);
  return json;
}
`,
  "apps/web/src/state/store.ts": `import { create } from "zustand";

type Session = { userId: string; token: string } | null;
type State = {
  session: Session;
  selectedTaskId: string | null;
  optimisticStatuses: Record<string, string>;
  login: (s: NonNullable<Session>) => void;
  select: (id: string | null) => void;
  optimisticStatus: (id: string, status: string) => void;
};

export const useStore = create<State>((set) => ({
  session: null,
  selectedTaskId: null,
  optimisticStatuses: {},
  login: (session) => set({ session }),
  select: (selectedTaskId) => set({ selectedTaskId }),
  optimisticStatus: (id, status) =>
    set((s) => ({ optimisticStatuses: { ...s.optimisticStatuses, [id]: status } })),
}));
`,
  "apps/web/src/components/TaskList.tsx": `import { useEffect } from "react";
import { useStore } from "../state/store.js";
import { fetchTask } from "../api/client.js";

export function TaskList() {
  const select = useStore((s) => s.select);
  useEffect(() => { void fetchTask("demo"); }, []);
  return <ul onClick={() => select("demo")}>…</ul>;
}
`,
  "apps/web/src/components/TaskDetail.tsx": `import { useStore } from "../state/store.js";

export function TaskDetail() {
  const id = useStore((s) => s.selectedTaskId);
  const status = useStore((s) => (id ? s.optimisticStatuses[id] : undefined));
  if (!id) return null;
  return <section><h2>{id}</h2><p>status: {status ?? "…"}</p></section>;
}
`,
  "apps/web/src/components/Header.tsx": `import { useStore } from "../state/store.js";

export function Header() {
  const session = useStore((s) => s.session);
  return <header>acme-ops {session ? "(" + session.userId + ")" : "(anon)"}</header>;
}
`,
  "packages/shared/package.json": `{ "name": "@acme/shared", "type": "module", "main": "src/index.ts" }
`,
  "packages/shared/src/index.ts": `export * from "./types/task.js";
export * from "./types/user.js";
export * from "./events.js";
export * from "./validation.js";
export * from "./cache.js";
`,
  "packages/shared/src/types/task.ts": `export type TaskStatus = "open" | "assigned" | "done" | "cancelled";
export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  userId?: string;
  createdAt?: string;
}
`,
  "packages/shared/src/types/user.ts": `export interface User {
  id: string;
  email: string;
  displayName?: string;
}
`,
  "packages/shared/src/events.ts": `// Canonical event names on the BullMQ "tasks" queue. Producers must use these.
export type TaskEventName = "task-created" | "task-assigned" | "reindex";
`,
  "packages/shared/src/validation.ts": `import type { Task } from "./types/task.js";

export function validateTask(input: unknown): Task {
  const t = input as Task;
  if (!t || typeof t.title !== "string" || t.title.length === 0) {
    throw new Error("invalid task");
  }
  return t;
}
`,
  "packages/shared/src/cache.ts": `// BROWSER LRU for apps/web (50 entries, Map-based). This is NOT the server
// cache — the Redis one is services/api/src/cache.ts. Never import from services.
const MAX = 50;
const map = new Map<string, unknown>();

export const lru = {
  get(key: string): unknown {
    const v = map.get(key);
    if (v === undefined) return undefined;
    map.delete(key); map.set(key, v); // refresh recency
    return v;
  },
  set(key: string, value: unknown): void {
    if (map.size >= MAX) map.delete(map.keys().next().value as string);
    map.set(key, value);
  },
};
`,
  "infra/nginx/nginx.conf": `server {
  listen 80;
  location /api/ { proxy_pass http://api:8080/; }
  location / { proxy_pass http://web:5173/; }
}
`,
  "infra/grafana/dashboard.json": `{ "title": "acme-ops", "panels": [ { "type": "graph", "title": "queue depth", "targets": [{ "expr": "bullmq_waiting" }] } ] }
`,
  "scripts/seed.ts": `import { pool } from "../services/api/src/db/pool.js";
await pool.query("insert into users (email, display_name) values ($1,$2) on conflict do nothing", ["ops@acme.test", "Ops"]);
process.exit(0);
`,
  "scripts/smoke.sh": `#!/usr/bin/env bash
set -e
curl -sf http://localhost:8080/health
echo "smoke ok"
`,
  ".github/workflows/ci.yml": `name: ci
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm install
      - run: npm -w services/api exec tsc -- --noEmit
`,
  ".gitignore": `node_modules/
dist/
.env
`,
};

rmSync(ROOT, { recursive: true, force: true });
for (const [rel, content] of Object.entries(F)) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, "utf8");
}
chmodSync(join(ROOT, "scripts", "smoke.sh"), 0o755);

// git init + seeded history (R4 needs recent-file signal)
const git = (c) => execSync(c, { cwd: ROOT, stdio: "pipe" });
git("git init -q");
git("git config user.email fixture@acme.test");
git("git config user.name fixture");
git("git add docs packages");
git("git commit -qm \"feat: shared types, events, validation, ADRs\"");
git("git add services/api");
git("git commit -qm \"feat(api): routes, auth, ratelimit, redis cache, pg pool\"");
git("git add services/worker");
git("git commit -qm \"feat(worker): bullmq queues, handlers, dlq\"");
git("git add apps/web infra scripts .github package.json docker-compose.yml README.md .env.example .gitignore");
git("git commit -qm \"feat(web,infra): spa shell, nginx, grafana, ci\"");

const n = Object.keys(F).length;
console.log("fixture written:", n, "files at", ROOT);
