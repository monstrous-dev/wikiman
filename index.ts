/**
 * Wiki Context Extension
 *
 * Makes docs/wiki/ (an OKF bundle) the agent's navigation layer:
 *  - Injects index.md + overview.md into context ONCE per session (re-injects
 *    only if compaction/resume drops the marker).
 *  - Lazy-load tools: wiki_get, wiki_search, wiki_related.
 *  - Session-start staleness check vs docs/wiki/last_updated.md (git, else mtime),
 *    respecting .wiki_ignore. Asks the user to update; footer until synced.
 *  - Learnings + preferences OKF folders written via named tools.
 *  - /wiki:init scaffolds a stub bundle (session_start asks before first init;
 *    declined folders are remembered in ~/.pi/agent/.wiki-omitted.json).
 *
 * See spec: this file is the single source of truth. No abstractions, one file.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { join, relative, dirname, basename, extname, resolve } from "node:path";
import { generateWikiDataJs, generateWikiViewerHtml, serveWikiViewer, shutdownAllWikiServers } from "./viewer.js";

const WIKI_DIR_NAME = "docs/wiki";
const IGNORE_FILE = ".wiki_ignore";

// Built-in ignores — ALWAYS applied on top of .wiki_ignore. Covers the
// artifact trees of common frameworks/package managers so staleness counts
// can't be flooded by build output in ANY project, even with no .wiki_ignore.
// (Root cause of the "3485 files changed" flood: src-tauri/target/ matched
// no pattern.) Gitignore-style names, matched by isIgnored below.
const BUILTIN_IGNORES = [
  // JS/TS ecosystems
  "node_modules/", ".svelte-kit/", ".next/", ".nuxt/", ".output/", ".astro/",
  ".vite/", ".turbo/", ".angular/", ".expo/", ".docusaurus/", ".parcel-cache/",
  "coverage/", ".nyc_output/",
  // Rust / PHP / Ruby / Elixir
  "target/", "vendor/", "_build/", "dist-newstyle/",
  // Python
  ".venv/", "venv/", ".tox/", ".mypy_cache/", ".pytest_cache/", ".ruff_cache/",
  ".hypothesis/",
  // JVM / .NET / Haskell
  ".gradle/", ".stack-work/", "bin/", "obj/",
  // Apple / Flutter
  "Pods/", "DerivedData/", ".dart_tool/",
  // Misc tooling / caches
  ".terraform/", ".yarn/", ".pnpm-store/", ".idea/", ".vscode/",
  "dist/", "build/", "out/", ".cache/", "__pycache__/", ".DS_Store", ".git/",
  // Lock files — churn on every install, meaningless for the wiki
  "*.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
];
const LAST_UPDATED = "last_updated.md";
// Folders where the user declined wiki init (asked once, never re-asked).
// ponytail: flat array keyed by absolute path; per-project state file if this ever needs metadata.
const OMITTED_FILE = join(homedir(), ".pi", "agent", ".wiki-omitted.json");
const SENTINEL = "<!-- wiki-context:v1 -->";
const FOOTER_KEY = "wiki";
const RESOURCE_TRUNCATE = 200;
// Linked-worktree mode: reads work, writes refuse (wiki lives in main checkout).
let IS_WORKTREE = false;
const MEMORY_FILE = "memory.md";
const MEMORY_START = "<!-- wiki-memory:start -->";
const MEMORY_END = "<!-- wiki-memory:end -->";

// ponytail: no hardcoded ignore defaults — project may not be a codebase.
// .wiki_ignore is only written when the user asks or the LLM generates it.

// ---------------------------------------------------------------------------
// FS helpers
// ---------------------------------------------------------------------------

function wikiDir(cwd: string): string {
  return join(cwd, WIKI_DIR_NAME);
}

// --- Omitted-folders registry (user declined wiki init; ask once) ---

function loadOmitted(): string[] {
  try {
    const raw = JSON.parse(readFileSync(OMITTED_FILE, "utf8"));
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return []; // missing or corrupt → treat as empty
  }
}

function saveOmitted(list: string[]): void {
  try {
    writeFileSync(OMITTED_FILE, JSON.stringify(list, null, 2) + "\n", "utf8");
  } catch {
    // best-effort: worst case we re-ask next session
  }
}

// Per-cwd timestamps of the last staleness "update?" ask — 1h cooldown so a
// declined ask doesn't nag every new session. ponytail: flat map, epoch ms.
const ASKED_FILE = join(homedir(), ".pi", "agent", ".wiki-asked.json");

function loadAsked(): Record<string, number> {
  try {
    const raw = JSON.parse(readFileSync(ASKED_FILE, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {}; // missing or corrupt → treat as never asked
  }
}

/** true if the staleness ask fired for this cwd less than an hour ago. */
function askedRecently(cwd: string): boolean {
  const at = loadAsked()[cwd];
  return typeof at === "number" && Date.now() - at < 60 * 60 * 1000;
}

/** record the ask BEFORE showing the dialog — even one left open across a
 *  session switch must not re-trigger the prompt within the hour. */
function markAsked(cwd: string): void {
  try {
    const m = loadAsked();
    m[cwd] = Date.now();
    writeFileSync(ASKED_FILE, JSON.stringify(m, null, 2) + "\n", "utf8");
  } catch {
    // best-effort: worst case we re-ask next session
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

interface Frontmatter {
  yaml: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(text: string): Frontmatter {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { yaml: {}, body: text };
  const yaml: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let val: unknown = kv[2].trim();
    // crude list parse: [a, b]
    const listM = (val as string).match(/^\[(.*)\]$/);
    if (listM) {
      val = listM[1].split(",").map((x) => x.trim()).filter(Boolean);
    } else if ((val as string).startsWith('"') && (val as string).endsWith('"')) {
      val = (val as string).slice(1, -1);
    }
    yaml[kv[1]] = val;
  }
  return { yaml, body: m[2] };
}

function buildFrontmatter(yaml: Record<string, unknown>): string {
  const lines = Object.entries(yaml).map(([k, v]) => {
    if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
    if (typeof v === "string" && /[:\[\]#]/.test(v)) return `${k}: "${v}"`;
    return `${k}: ${v}`;
  });
  return `---\n${lines.join("\n")}\n---\n`;
}

async function readConcept(
  cwd: string,
  concept: string,
): Promise<{ path: string; text: string } | null> {
  const stripped = concept.replace(/^@/, "").replace(/\.md$/, "");
  const candidates = [
    join(wikiDir(cwd), `${stripped}.md`),
    join(wikiDir(cwd), stripped), // already .md or index
    join(wikiDir(cwd), stripped, "index.md"),
  ];
  for (const p of candidates) {
    if (existsSync(p) && (await stat(p).then((s) => s.isFile()).catch(() => false))) {
      return { path: p, text: await readFile(p, "utf8") };
    }
  }
  return null;
}

/** Extract a `resource:` (or any path-looking value) from frontmatter. */
function resourcePath(yaml: Record<string, unknown>): string | null {
  const r = yaml.resource;
  if (typeof r === "string" && r.trim()) {
    return r.trim().replace(/^\.\//, "");
  }
  return null;
}

/** Extract markdown links from body, return resolved wiki-relative concepts. */
function extractLinks(body: string): string[] {
  const links = new Set<string>();
  const re = /\[[^\]]+\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    let target = m[1];
    if (/^https?:/.test(target)) continue; // external
    target = target.replace(/^\.\//, "").replace(/^\.\.\//g, "").replace(/\.md$/, "");
    links.add(target);
  }
  return [...links];
}

async function appendIndex(
  indexPath: string,
  slug: string,
  title: string,
  description: string,
  kind: string,
): Promise<void> {
  let existing = "";
  if (existsSync(indexPath)) {
    existing = await readFile(indexPath, "utf8");
  }
  // Remove any existing line for this slug (dedupe).
  const kept = existing
    .split(/\r?\n/)
    .filter((l) => !l.includes(`./${slug}.md`))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
  const entry = `- [${title}](./${slug}.md) - ${description}`;
  let out: string;
  if (!kept.trim()) {
    out = `# ${kind}\n\n${entry}\n`;
  } else if (/^# /.test(kept)) {
    out = `${kept.trimEnd()}\n${entry}\n`;
  } else {
    out = `# ${kind}\n\n${entry}\n${kept}\n`;
  }
  await writeFile(indexPath, out, "utf8");
}

/** Refuse wiki writes from linked-worktree sessions (single source of truth,
 *  no stray uncommitted edits that block stash/pull in the main checkout). */
function worktreeWriteRefusal(): { content: Array<{ type: "text"; text: string }> } | null {
  if (!IS_WORKTREE) return null;
  return {
    content: [{ type: "text" as const,
      text: "docs/wiki/ is read-only in this worktree session — wiki writes happen in the main checkout only (single source of truth; stray worktree wiki edits caused stash/pull conflicts). Reads work normally (wiki_get, wiki_search, wiki_related, wiki_discover). Re-run write tasks from the main checkout." }],
  };
}

/** Write a page (Concept, Entity, or Artifact) into pages/<type-plural>/. */
async function notePage(
  cwd: string,
  pageType: "Concept" | "Entity" | "Artifact",
  title: string,
  body: string,
  tags?: string[],
  extra?: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const folderMap: Record<string, string> = { Concept: "concepts", Entity: "entities", Artifact: "artifacts" };
  const refuse = worktreeWriteRefusal(); if (refuse) return refuse;
  const folder = folderMap[pageType];
  const dir = join(wikiDir(cwd), "pages", folder);
  await mkdir(dir, { recursive: true });
  const slug = slugify(title);
  const now = new Date().toISOString();
  const firstLine = body.split(/\r?\n/).find((l) => l.trim())?.trim() || title;
  const description = firstLine.replace(/^#{1,6}\s*/, "").slice(0, 160);

  // ponytail: convert [[wikilink]] syntax to standard markdown links
  // [[slug]] → [slug](./slug.md) — relative links within same page type folder
  let processedBody = body.replace(/\[\[([^\]]+)\]\]/g, (_m, target: string) => {
    const targetSlug = slugify(target.replace(/^pages\/(?:concepts|entities|artifacts)\//, ""));
    return `[${target}](./${targetSlug}.md)`;
  });

  const fm = buildFrontmatter({
    type: pageType,
    title,
    description,
    ...(tags && tags.length ? { tags } : {}),
    ...(extra ?? {}),
    timestamp: now,
  });

  // slug collision detection
  let conceptPath = join(dir, `${slug}.md`);
  if (existsSync(conceptPath)) {
    const existing = await readFile(conceptPath, "utf8");
    const { yaml: exYaml } = parseFrontmatter(existing);
    if (String(exYaml.title || "") !== title) {
      let suffix = 2;
      while (existsSync(join(dir, `${slug}-${suffix}.md`))) suffix++;
      conceptPath = join(dir, `${slug}-${suffix}.md`);
    }
  }

  await writeFile(conceptPath, `${fm}\n# ${title}\n\n${processedBody.trim()}\n`, "utf8");
  await appendIndex(join(dir, "index.md"), slug, title, description, folder.charAt(0).toUpperCase() + folder.slice(1));

  // Update pages/index.md
  const pagesIndexPath = join(wikiDir(cwd), "pages", "index.md");
  if (existsSync(pagesIndexPath)) {
    let pagesIndex = await readFile(pagesIndexPath, "utf8");
    if (!pagesIndex.includes(`./${folder}/${slug}.md`)) {
      pagesIndex = pagesIndex.trimEnd() + `\n- [${title}](./${folder}/${slug}.md) — ${description}\n`;
      await writeFile(pagesIndexPath, pagesIndex, "utf8");
    }
  }
  try { await regenerateMemory(cwd); } catch { /* best effort */ }

  return {
    content: [
      { type: "text", text: `Recorded ${pageType.toLowerCase()}: ${title} → docs/wiki/pages/${folder}/${slug}.md (index + memory updated).` },
    ],
  };
}

/** Write a learning/preference concept + update its folder index. */
async function noteInto(
  cwd: string,
  folder: "learnings" | "preferences" | "decisions" | "rules",
  type: string,
  title: string,
  body: string,
  tags?: string[],
  extra?: Record<string, unknown>,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const refuse = worktreeWriteRefusal(); if (refuse) return refuse;
  const dir = join(wikiDir(cwd), folder);
  await mkdir(dir, { recursive: true });
  const slug = slugify(title);
  const now = new Date().toISOString();
  // ponytail: strip markdown headings from auto-extracted description
  const firstLine = body.split(/\r?\n/).find((l) => l.trim())?.trim() || title;
  const description = firstLine.replace(/^#{1,6}\s*/, "").slice(0, 160);
  const fm = buildFrontmatter({
    type,
    title,
    description,
    ...(tags && tags.length ? { tags } : {}),
    ...(extra ?? {}),
    timestamp: now,
  });
  // ponytail: detect slug collision — append suffix if file exists for a different title
  let conceptPath = join(dir, `${slug}.md`);
  if (existsSync(conceptPath)) {
    const existing = await readFile(conceptPath, "utf8");
    const { yaml: exYaml } = parseFrontmatter(existing);
    if (String(exYaml.title || "") !== title) {
      let suffix = 2;
      while (existsSync(join(dir, `${slug}-${suffix}.md`))) suffix++;
      conceptPath = join(dir, `${slug}-${suffix}.md`);
    }
  }
  await writeFile(conceptPath, `${fm}\n# ${title}\n\n${body.trim()}\n`, "utf8");
  await appendIndex(join(dir, "index.md"), slug, title, description, folder.charAt(0).toUpperCase() + folder.slice(1));
  try { await regenerateMemory(cwd); } catch { /* best effort */ }
  return {
    content: [
      { type: "text", text: `Recorded ${type.toLowerCase()}: ${title} → docs/wiki/${folder}/${slug}.md (index + memory updated).` },
    ],
  };
}

// ---------------------------------------------------------------------------
// OKF validator (3 conformance rules + 5 warnings)
// E1 no frontmatter · E2 missing 'type' · E3 type not in allowed set
// W1 missing title/description · W2 long filename · W3 missing/bad timestamp
// W4 broken cross-link · W5 declared folder with no concepts
// ---------------------------------------------------------------------------

interface ValidationReport {
  errors: string[]; // E0–E3
  warnings: string[]; // W1–W5
}

const RESERVED = new Set(["index.md", MEMORY_FILE, "log.md", LAST_UPDATED]);

// Allowed frontmatter 'type' values. Anything else → E3.
const ALLOWED_TYPES = new Set([
  "Learning", "Rule", "Decision", "Preference",
  "Concept", "Entity", "Artifact", "System Overview", "Glossary",
]);

// Typed concept folders that should hold at least one concept (not just index.md).
const TYPED_FOLDERS = ["learnings", "preferences", "decisions", "rules"];

async function walkMd(dir: string, acc: string[] = []): Promise<string[]> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) await walkMd(p, acc);
    else if (ent.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

export async function validateBundle(cwd: string): Promise<ValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const root = wikiDir(cwd);
  if (!existsSync(root)) {
    errors.push("E0: docs/wiki/ does not exist");
    return { errors, warnings };
  }
  const files = await walkMd(root);
  for (const f of files) {
    const rel = relative(root, f).replace(/\\/g, "/");
    if (RESERVED.has(basename(f))) {
      // index.md/log.md must not have frontmatter (except root index's okf_version)
      continue;
    }
    const text = await readFile(f, "utf8");
    const { yaml, body } = parseFrontmatter(text);
    if (!/^---/.test(text)) {
      errors.push(`E1: ${rel} has no YAML frontmatter`);
      continue;
    }
    if (!yaml.type || String(yaml.type).trim() === "") {
      errors.push(`E2: ${rel} frontmatter missing 'type'`);
    } else if (!ALLOWED_TYPES.has(String(yaml.type).trim())) {
      errors.push(`E3: ${rel} type "${yaml.type}" not in allowed set: ${[...ALLOWED_TYPES].join(" | ")}`);
    }
    if (!yaml.title) warnings.push(`W1: ${rel} missing 'title'`);
    if (!yaml.description) warnings.push(`W1: ${rel} missing 'description'`);
    if (!yaml.timestamp) {
      warnings.push(`W3: ${rel} missing 'timestamp'`);
    } else if (Number.isNaN(Date.parse(String(yaml.timestamp)))) {
      warnings.push(`W3: ${rel} timestamp is not valid ISO 8601: "${yaml.timestamp}"`);
    }
    // W2: long, sentence-like filenames are hard to reference and truncate in the nav map.
    const stem = basename(f, ".md");
    if (stem.length > 50) warnings.push(`W2: ${rel} filename is ${stem.length} chars — shorten to a stable id`);
    // W4: cross-links whose target file doesn't exist (drift after deletion/rename).
    // Resolve each raw link target relative to the source file's dir, not the wiki root.
    const linkRe = /\[[^\]]+\]\(([^)]+)\)/g;
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(body))) {
      const raw = lm[1];
      if (/^(https?:|#|mailto:)/.test(raw)) continue; // external / anchor / mail
      if (!existsSync(resolve(dirname(f), raw))) warnings.push(`W4: ${rel} links to missing "${raw}"`);
    }
  }
  // W5: typed folder declared (exists) but holds no concepts besides index.md.
  for (const d of TYPED_FOLDERS) {
    const dir = join(root, d);
    if (!existsSync(dir)) continue;
    const ents = await readdir(dir);
    const concepts = ents.filter((n) => n.endsWith(".md") && n !== "index.md");
    if (concepts.length === 0) warnings.push(`W5: ${d}/ declared but has no concepts`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// .wiki_ignore matcher
// ---------------------------------------------------------------------------

async function loadIgnore(cwd: string): Promise<{ patterns: string[]; loaded: boolean }> {
  const p = join(cwd, IGNORE_FILE);
  if (!existsSync(p)) return { patterns: BUILTIN_IGNORES, loaded: false };
  const text = await readFile(p, "utf8");
  const patterns = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  // Built-ins always apply; .wiki_ignore only ADDS project-specific entries.
  return { patterns: [...BUILTIN_IGNORES, ...patterns], loaded: true };
}

/** ponytail: glob match is minimal — supports dir/, *.ext, exact name. */
function isIgnored(path: string, patterns: string[]): boolean {
  const norm = path.replace(/\\/g, "/");
  for (const pat of patterns) {
    const p = pat.replace(/\\/g, "/");
    if (p.endsWith("/")) {
      if (norm.includes(`/${p}`) || norm.startsWith(p) || norm.includes(p.slice(0, -1) + "/"))
        return true;
    } else if (p.startsWith("*.")) {
      if (norm.endsWith(p.slice(1))) return true;
    } else {
      if (norm === p || norm.endsWith(`/${p}`)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

async function detectChanged(cwd: string, sinceTs: number): Promise<string[]> {
  // ponytail: pure mtime comparison — last_updated timestamp vs file stamps.
  // The git-log approach violated this (it compared against COMMIT times,
  // not file times, so uncommitted edits were invisible). One code path,
  // honors the contract directly.
  const { patterns } = await loadIgnore(cwd);
  return mtimeScan(cwd, sinceTs, patterns);
}

async function mtimeScan(cwd: string, sinceTs: number, patterns: string[] = []): Promise<string[]> {
  const out: string[] = [];
  // ponytail: prune ignored dirs DURING the walk (not after) so huge trees
  // like node_modules/ are never descended into. Keeps the scan fast while
  // honoring .wiki_ignore.
  // ponytail: depth cap at 50 matches generateFileTree — prevents stack
  // overflow on pathological trees. Real projects don't nest deeper.
  const ignoreDirs = new Set([".git", ".pi"]);
  async function walk(dir: string, depth: number) {
    let ents;
    try {
      ents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const rel = relative(cwd, join(dir, e.name)).replace(/\\/g, "/");
      if (e.isDirectory()) {
        // Skip always-ignored + .wiki_ignore-matched dirs early.
        if (ignoreDirs.has(e.name) || isIgnored(rel + "/", patterns)) continue;
        if (depth >= 50) continue; // ponytail: depth cap
        await walk(join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        if (isIgnored(rel, patterns)) continue;
        try {
          const s = await stat(join(dir, e.name));
          if (s.mtimeMs > sinceTs) out.push(rel);
        } catch {
          /* skip */
        }
      }
    }
  }
  await walk(cwd, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Per-concept resource staleness
// ---------------------------------------------------------------------------

/** Git last-commit time (ms) of a file, or null. Commit-time survives fresh
 *  worktree checkouts (which reset mtimes); used for resource staleness. */
function gitCommitTime(cwd: string, file: string): number | null {
  try {
    const out = execSync(`git log -1 --format=%ct -- "${file}"`, {
      cwd, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    const t = parseInt(out, 10);
    return Number.isFinite(t) && t > 0 ? t * 1000 : null;
  } catch {
    return null;
  }
}

/** Concepts whose `resource:` source changed AFTER the concept was written.
 *  Catches docs that were accurate at write time but drifted — invisible to
 *  the global last_updated clock (any wiki write resets it). */
async function detectStaleConcepts(cwd: string): Promise<Array<{ rel: string; resource: string }>> {
  const root = wikiDir(cwd);
  if (!existsSync(root)) return [];
  const out: Array<{ rel: string; resource: string }> = [];
  for (const f of await walkMd(root)) {
    if (RESERVED.has(basename(f))) continue;
    let text: string;
    try {
      text = await readFile(f, "utf8");
    } catch {
      continue;
    }
    const { yaml } = parseFrontmatter(text);
    const res = resourcePath(yaml);
    if (!res) continue;
    const docTs = yaml.timestamp ? Date.parse(String(yaml.timestamp)) : NaN;
    if (!Number.isFinite(docTs)) continue;
    const abs = resolve(cwd, res);
    if (!existsSync(abs)) continue; // resource gone — not this check's job
    const resTs = gitCommitTime(cwd, res)
      ?? (await stat(abs).then((s) => s.mtimeMs).catch(() => null));
    if (resTs == null) continue;
    // 5-min tolerance against same-touch clock noise.
    if (resTs > docTs + 5 * 60_000) {
      out.push({ rel: relative(root, f).replace(/\\/g, "/").replace(/\.md$/, ""), resource: res });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lazy API handle for tools (factory-scoped)
// ---------------------------------------------------------------------------

let _api: ExtensionAPI | null = null;
function getApi(): { pi: ExtensionAPI } {
  if (!_api) throw new Error("wiki-context: api not initialized");
  return { pi: _api };
}

// ---------------------------------------------------------------------------
// End-of-turn recap (agent_end) — async wiki-recap subagent
// ---------------------------------------------------------------------------
// At the FINAL agent_end of a user turn we spawn the `wiki-recap` agent in a
// SEPARATE process (via intelligent-delegation's runSingleSubagent) to mine the
// turn for decisions / rules / learnings and record them. Because agent_end
// fires once per agent RUN and a prompt can chain runs (prompt -> continue for
// steer/retry/compaction/queued msgs), the spawn is DEBOUNCED: scheduled on
// agent_end, cancelled by the next agent_start / compaction_start. Only the
// last agent_end of the prompt fires. Fire-and-forget: the user never waits,
// the parent session's context never grows. This replaces the old inline
// classifyTurn + next-turn-nudge loop — the subagent both classifies AND
// records in isolation.

// Set before any hidden/system dispatch (init auto-doc, staleness delegation
// steer) so that turn's agent_end doesn't spuriously spawn a recap. Checked and
// cleared at the top of the agent_end handler. The recap subagent itself runs
// in a child process — its agent_end fires there, not here, so no feedback loop.
let suppressRecap = false;

// Debounce timer for the recap spawn. agent_end fires once per agent RUN, and a
// single user prompt can chain multiple runs (prompt -> continue for
// steer/retry/compaction/queued msgs). To avoid spawning a recap per run, we
// schedule on agent_end and cancel on agent_start / compaction_start — only the
// FINAL agent_end (no continuation follows) actually fires the recap.
let recapTimer: ReturnType<typeof setTimeout> | undefined;
const RECAP_DEBOUNCE_MS = 1200;

const RECAP_AGENT = "wiki-recap";
// ponytail: cap the transcript handed to the recap subagent — first ~8KB carries
// the substance, keeps the spawn cheap.
const RECAP_MAX_CHARS = 8000;

/** Extract text content from a single message object (user or assistant). */
function messageText(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const m = msg as { role?: string; content?: unknown };
  if (m.role !== "assistant" && m.role !== "user") return "";
  const c = m.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((p) => p && typeof p === "object" && (p as { type?: string }).type === "text")
      .map((p) => (p as { text?: string }).text ?? "")
      .join("\n");
  }
  return "";
}

/** Concatenate user + assistant text from an agent_end event.messages array. */
function collectTurnText(
  messages: Array<{ message?: { role?: string; content?: unknown } } | { role?: string; content?: unknown }>,
): string {
  const out: string[] = [];
  for (const raw of messages ?? []) {
    const msg = (raw as { message?: unknown })?.message ?? raw;
    const role = (msg as { role?: string })?.role;
    const t = messageText(msg);
    if (!t) continue;
    out.push(role === "user" ? `USER: ${t}` : `ASSISTANT: ${t}`);
  }
  return out.join("\n\n");
}

/** Extract the parent session's model ref ("provider/id") for sub-agent inheritance. */
function parentModelRef(ctx: any): string | undefined {
  const m = ctx?.model;
  if (m && typeof m === "object" && typeof m.provider === "string" && typeof m.id === "string") {
    return `${m.provider}/${m.id}`;
  }
  return undefined;
}

/**
 * Fire-and-forget spawn of the wiki-recap agent. Dynamic-imports the
 * intelligent-delegation runner so wiki-context still loads if that extension is
 * absent (graceful no-op + notify). Resolves silently; never throws to caller.
 */
/**
 * Debounced wrapper around spawnRecap: clears any pending spawn and re-arms it.
 * A subsequent agent_start / compaction_start (i.e. a continuation) cancels
 * via clearRecapTimer(), so only the last agent_end of a prompt spawns.
 */
function scheduleRecap(
  cwd: string,
  turnText: string,
  parentModel: string | undefined,
  notify?: (msg: string, type?: "info" | "warning" | "error") => void,
): void {
  clearRecapTimer();
  recapTimer = setTimeout(() => {
    recapTimer = undefined;
    spawnRecap(cwd, turnText, parentModel, notify);
  }, RECAP_DEBOUNCE_MS);
}

/**
 * Wrap an extension ctx so deferred/async use cannot crash pi when the
 * session was replaced or reloaded mid-flight (newSession/fork/switchSession/
 * reload mark the captured ctx stale and ctx.ui / ctx.hasUI throw). Any code
 * path that touches ctx after an await — debounced timers, confirm dialogs,
 * subagent runs, server starts — must go through this. When live it is a
 * pass-through; when stale, ui becomes a no-op and hasUI reads false.
 */
function staleSafeCtx<T extends object>(ctx: T): T {
  // Self-referential deep no-op: any property (theme.fg, notify, ...) or call
  // returns noop; string coercion yields "" so template concats never throw.
  const noop: any = new Proxy(function () {} as any, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive || prop === "toString" || prop === "valueOf") return () => "";
      return noop;
    },
    apply: () => noop,
  });
  return new Proxy(ctx, {
    get(target: any, prop, receiver) {
      if (prop === "ui" || prop === "hasUI") {
        try {
          return Reflect.get(target, prop, target);
        } catch {
          return prop === "ui" ? noop : false; // stale ctx — swallow
        }
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}

function clearRecapTimer(): void {
  if (recapTimer) {
    clearTimeout(recapTimer);
    recapTimer = undefined;
  }
}

function spawnRecap(
  cwd: string,
  turnText: string,
  parentModel: string | undefined,
  notify?: (msg: string, type?: "info" | "warning" | "error") => void,
): void {
  const snippet = turnText.length > RECAP_MAX_CHARS ? turnText.slice(0, RECAP_MAX_CHARS) + "\n[...truncated]" : turnText;
  const task =
    `Review the following coding-session turn and record any MAJOR decisions, reusable rules/heuristics, or learnings into docs/wiki/. Also scan for frontend UX/CRUD/action changes that benefit end-users and log them via wiki_changelog with user-facing fields. Also detect new project concepts, entities, or artifacts and document them via wiki_note_page. Be selective — routine work warrants zero writes. Dedupe via wiki_search before writing wiki concepts. Then wiki_validate, wiki_changelog (with user-facing fields: category, user, what, why, next — see tool description), wiki_timestamp. See your system prompt for details.\n\n` +
    `--- TURN ---\n${snippet}\n--- END TURN ---`;
  spawnWikiAgent(cwd, RECAP_AGENT, task, parentModel, notify);
}

/**
 * Fire-and-forget spawn of a wiki subagent (wiki-recap, wiki-curator, …) via
 * the intelligent-delegation runner. Shared by the debounced recap and the
 * /wiki:update command. Notifies on completion; never throws to caller.
 */
function spawnWikiAgent(
  cwd: string,
  agentName: string,
  task: string,
  parentModel: string | undefined,
  notify?: (msg: string, type?: "info" | "warning" | "error") => void,
): void {
  (async () => {
    let runner: any;
    let agentsMod: any;
    try {
      [runner, agentsMod] = await Promise.all([
        import("../intelligent-delegation/runner.ts"),
        import("../intelligent-delegation/agents.ts"),
      ]);
    } catch {
      notify?.(`wiki ${agentName} skipped: intelligent-delegation extension not available.`, "warning");
      return;
    }
    const agents = agentsMod.discoverAgents(cwd, "both").agents;
    if (!agents.some((a: any) => a.name === agentName)) {
      notify?.(`wiki ${agentName} skipped: "${agentName}" agent not found in ~/.pi/agent/agents.`, "warning");
      return;
    }
    // ponytail: stub details callback — we don't render, just notify on done.
    const makeDetails = (results: unknown) => ({ mode: "async", agentScope: "both", projectAgentsDir: null, results });
    try {
      const result = await runner.runSingleSubagent(
        cwd, agents, agentName, task, cwd, undefined, undefined,
        makeDetails, undefined, parentModel,
      );
      if (runner.isFailedResult(result)) {
        notify?.(`wiki ${agentName} ${result.stopReason || "failed"}: ${runner.getResultOutput(result).slice(0, 300)}`, "error");
      } else {
        const out = runner.getResultOutput(result).trim();
        notify?.(out ? `${agentName}:\n${out.slice(0, 600)}` : `${agentName}: nothing to record.`, "info");
      }
    } catch (e) {
      notify?.(`wiki ${agentName} errored: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  })();
}

// ---------------------------------------------------------------------------
// Staleness check (session_start)
// ---------------------------------------------------------------------------

const CURATOR_AGENT = "wiki-curator";

/**
 * Build the wiki-update task (changed files + OKF findings) shared by the
 * session-start staleness prompt and /wiki:update. Returns null when the
 * wiki is fresh and conformant.
 */
async function buildUpdateTask(
  cwd: string,
): Promise<{ changed: string[]; staleConcepts: Array<{ rel: string; resource: string }>; task: string } | null> {
  const sinceTs = await readLastUpdated(cwd);
  const changed = await detectChanged(cwd, sinceTs);
  const report = await validateBundle(cwd);
  const staleConcepts = await detectStaleConcepts(cwd);
  if (changed.length === 0 && report.errors.length === 0 && staleConcepts.length === 0) return null;
  const parts: string[] = [];
  if (changed.length > 0) {
    parts.push(
      `The wiki may be stale. ${changed.length} file(s) changed since the last sync:\n` +
        changed.slice(0, 40).map((c) => `  - ${c}`).join("\n"),
    );
  }
  if (staleConcepts.length > 0) {
    parts.push(
      `Concepts whose declared source (resource: frontmatter) changed after the doc was written — verify and refresh their claims against the current source:\n` +
        staleConcepts.slice(0, 20).map((s) => `  - ${s.rel} (resource: ${s.resource})`).join("\n"),
    );
  }
  if (report.errors.length > 0) {
    parts.push(`OKF conformance errors to fix:\n` + report.errors.map((e) => `  - ${e}`).join("\n"));
  }
  if (report.warnings.length > 0) {
    parts.push(
      `OKF warnings (non-blocking):\n` + report.warnings.slice(0, 10).map((w) => `  - ${w}`).join("\n"),
    );
  }
  const task = parts.join("\n\n") +
    `\n\nUpdate the relevant docs/wiki/ concepts to reflect these changes, following the okf-open-knowledge-format skill. Call wiki_mark_synced() when done.`;
  return { changed, staleConcepts, task };
}

async function readLastUpdated(cwd: string): Promise<number> {
  const p = join(wikiDir(cwd), LAST_UPDATED);
  if (!existsSync(p)) return 0;
  const text = await readFile(p, "utf8");
  const tsLine = text.match(/\d{4}-\d{2}-\d{2}T[0-9:.Z+-]+/);
  if (!tsLine) return 0;
  const t = Date.parse(tsLine[0]);
  return Number.isNaN(t) ? 0 : t;
}

async function runStalenessCheck(rawCtx: { cwd: string; ui: ExtensionAPI extends never ? never : any; hasUI: boolean; isProjectTrusted: () => boolean }): Promise<void> {
  // ctx is used after awaits + a confirm dialog that can stay open across a
  // session switch/reload — staleSafeCtx prevents a stale ctx from crashing pi.
  const ctx = staleSafeCtx(rawCtx);
  const { cwd } = ctx;
  const sinceTs = await readLastUpdated(cwd);
  // Synced <1h ago: skip the scan and the prompt entirely — repeated
  // "update?" dialogs right after a sync are noise, and the mtime walk isn't free.
  if (sinceTs > 0 && Date.now() - sinceTs < 60 * 60 * 1000) {
    ctx.ui.setStatus(FOOTER_KEY, `wiki: ${ctx.ui.theme.fg("success", "●")} synced`);
    return;
  }
  const update = await buildUpdateTask(cwd);

  if (!update) {
    ctx.ui.setStatus(FOOTER_KEY, `wiki: ${ctx.ui.theme.fg("success", "●")} synced`);
    return;
  }
  const { changed, staleConcepts } = update;

  // Footer: staleness signal (decision 9b). Dot+text, theme-colored.
  const dot = (c: string) => ctx.ui.theme.fg(c, "●");
  const staleMsg = changed.length > 0
    ? `wiki: ${dot("error")} stale (${changed.length} files)`
    : staleConcepts.length > 0
      ? `wiki: ${dot("error")} ${staleConcepts.length} doc(s) cite changed sources`
      : `wiki: ${dot("warning")} issues`;
  ctx.ui.setStatus(FOOTER_KEY, staleMsg);

  // Build the update prompt (used whether we confirm or inject directly).
  const task = update.task;

  // Delegation prompt: instruct the main LLM to fire-and-forget to wiki-curator.
  // This keeps the main conversation responsive — wiki-curator runs in an
  // isolated context, results notified independently.
  // ponytail: display:false on the delegation prompt — the user already saw the
  // confirm dialog, and the prompt contains LLM-only instructions that would
  // read as noise in the chat ("Do NOT describe the delegation", etc.).
  const delegationPrompt =
    `Wiki staleness: ${changed.length} file(s) changed.\n` +
    `Delegate this to the wiki-curator agent in async mode with this task:\n\n` +
    `--- BEGIN TASK ---\n${task}\n--- END TASK ---\n\n` +
    `Do NOT describe the delegation. Just call delegate with mode "async" and continue with the user's next request.`;

  // RPC mode (e.g. a delegated wiki-curator sub-agent): there is no user to
  // confirm with — and pi core awaits session_start handlers BEFORE attaching
  // the RPC stdin reader, so the confirm can never be answered; with no active
  // handles left the event loop drains and the process exits 0 before the
  // delegated task ever runs. Skip entirely (footer status already set above).
  if (ctx.mode === "rpc") return;

  if (!ctx.hasUI) {
    // Headless: inject full task as-is (no delegate tool available).
    // ponytail: display:false — the task text is LLM-oriented, not user-facing.
    getApi().pi.sendMessage(
      { customType: "wiki-staleness", content: task, display: false },
      { triggerTurn: false, deliverAs: "nextTurn" },
    );
    return;
  }

  // Asked within the last hour — don't nag again (footer already shows
  // the staleness signal; only the dialog is suppressed).
  if (askedRecently(cwd)) return;

  markAsked(cwd);
  const wantUpdate = await ctx.ui.confirm(
    "Wiki staleness",
    changed.length > 0
      ? `Wiki may be stale: ${changed.length} file(s) changed since last sync. Update via wiki-curator?`
      : staleConcepts.length > 0
        ? `${staleConcepts.length} concept(s) reference source files that changed after they were written. Refresh via wiki-curator?`
        : `OKF issues detected in the wiki. Review via wiki-curator?`,
  );
  if (wantUpdate) {
    ctx.ui.setStatus(FOOTER_KEY, "wiki: delegating to wiki-curator...");
    // This steer becomes its own agent turn — suppress the recap for it.
    suppressRecap = true;
    getApi().pi.sendMessage(
      { customType: "wiki-staleness", content: delegationPrompt, display: false },
      { triggerTurn: true, deliverAs: "steer" },
    );
  }
}

// ---------------------------------------------------------------------------
// Marker check + injection (before_agent_start)
// ---------------------------------------------------------------------------

function markerInBranch(ctx: { sessionManager: { getBranch: () => Array<{ type: string; message?: { role?: string; content?: Array<{ type: string; text?: string }> | string } }> } }): boolean {
  try {
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const c = entry.message?.content;
      if (Array.isArray(c)) {
        for (const part of c) {
          if (part?.type === "text" && typeof part.text === "string" && part.text.includes(SENTINEL))
            return true;
        }
      } else if (typeof c === "string" && c.includes(SENTINEL)) {
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function buildInjection(cwd: string): Promise<string | null> {
  const indexP = join(wikiDir(cwd), "index.md");
  const overviewP = join(wikiDir(cwd), "overview.md");
  if (!existsSync(indexP)) return null;
  const index = await readFile(indexP, "utf8");
  const overview = existsSync(overviewP) ? await readFile(overviewP, "utf8") : "(no overview.md)";
  const memoryP = join(wikiDir(cwd), MEMORY_FILE);
  const memory = existsSync(memoryP) ? await readFile(memoryP, "utf8") : "";
  const hasFileTree = existsSync(join(wikiDir(cwd), "architecture", "file-tree.md"));
  // index.md carries the detailed nav map (auto-maintained section between
  // NAV markers), so reading it here gives the LLM the full navigational map.
  // Lead with an unmissable wiki-first lookup rule so the LLM consults the
  // wiki BEFORE reaching for grep/find/LSP when locating files, code, or logic.
  // Steps are built as an array so numbering stays correct whether or not the
  // project has a file-tree.md (no skipped numbers).
  const steps = [
    "**Scan the Navigation map in index.md below** (every concept: id — title — description, grouped by folder). It tells you which concept documents the area you need.",
    "**Read overview.md below** for the project's structure and major subsystems.",
  ];
  if (memory) {
    steps.push("**Read memory.md below** — the live contract: most recent decisions, rules, conventions, development patterns, architecture, global patterns. Follow its links (wiki_get) when a contract item matters to the current task.");
  }
  if (hasFileTree) {
    steps.push("**Consult architecture/file-tree.md** (call wiki_get(\"architecture/file-tree\")) for the complete project file listing with per-file descriptions — use it to jump straight to the right path instead of grepping blind.");
  }
  steps.push("**Only then** fall back to grep / find / rg / LSP / wiki_discover to pin down exact lines.");
  const numbered = steps.map((st, i) => `${i + 1}. ${st}`).join("\n");
  return `# ⚠ Wiki-first lookup rule (this project keeps a knowledge wiki — USE IT FIRST)

This project maintains an OKF knowledge wiki at docs/wiki/. It is the
authoritative map for where things live. When you need to LOCATE files, code,
or logic, follow this order and STOP at the first hit:

${numbered}

Do NOT start a search with grep/find when the wiki already names the relevant
files or concepts. Read the map first, every time, for every lookup task
(\"where is X\", \"trace the flow for Y\", \"find the logic that does Z\").

---

## index.md

${index}

## overview.md

${overview}
${memory ? `\n## memory.md — the live contract (recent decisions, rules, conventions, patterns)\n\n${memory}\n` : ""}
## Wiki tools (lazy-load concept bodies — do NOT read the whole bundle)
- wiki_get("<concept-id>") — read a concept by id/path (e.g. "learnings/foo", "architecture/file-tree"). Returns body + referenced source file.
- wiki_search("keyword") — find concepts by keyword (top 15).
- wiki_related("<concept-id>") — list cross-linked concepts with their descriptions.
- wiki_discover — explore the project filesystem by path, depth, and extension filter.
- wiki_changelog — record a changelog entry with user-facing fields (category, user, what, why, next) + developer detail (summary, files, action).
- Decisions: docs/wiki/decisions/ — wiki_note_decision for MAJOR decisions or direction shifts.
- Rules: docs/wiki/rules/ — wiki_note_rule for reusable heuristics, guidelines, conventions.
- Learnings: docs/wiki/learnings/ — wiki_note_learning for non-obvious facts, gotchas, behaviors.
- Preferences: docs/wiki/preferences/ — wiki_note_preference for stated style/convention preferences.
- Pages: docs/wiki/pages/ — wiki_note_page to document project concepts, entities, and artifacts with [[wikilinks]]. See TEMPLATES.md for page structures.
- Keep docs/wiki/last_updated.md current by calling wiki_mark_synced() after substantive edits.
- See the okf-open-knowledge-format skill for the spec.

## End-of-turn recap (automatic)
At the end of each turn this extension spawns the \`wiki-recap\` subagent in the
background. It mines the turn for MAJOR decisions, reusable rules/heuristics,
learnings, frontend UX changes, AND new project concepts/entities/artifacts, and
records them into docs/wiki/ on its own — you do NOT need to record these during
the turn. You can still call the wiki_note_* tools yourself if something is urgent
or explicit, but routine capture is handled for you.

## Proactive projectbase documentation
When you BUILD or MODIFY a module, endpoint, data model, or subsystem, ASK
YOURSELF: "is there a Concept or Entity here the wiki should document?" If yes,
call wiki_note_page during the turn — don't wait for the recap. Examples:
- Adding a new API route → Entity page for the endpoint.
- Introducing a caching layer → Concept page for the invalidation strategy.
- Creating a database schema → Entity page for each core model.
This keeps the wiki current as the codebase grows, not as an afterthought.

${SENTINEL}`;
}

// ---------------------------------------------------------------------------
// Bundle init scaffold
// ---------------------------------------------------------------------------

async function initBundle(cwd: string): Promise<void> {
  const root = wikiDir(cwd);
  // Why: typed folders (learnings/preferences/decisions/rules) are created on
  // demand by wiki_note_* — scaffolding them empty trips W5 (empty folder).
  await mkdir(join(root, "pages", "concepts"), { recursive: true });
  await mkdir(join(root, "pages", "entities"), { recursive: true });
  await mkdir(join(root, "pages", "artifacts"), { recursive: true });
  const now = new Date().toISOString();
  const day = now.slice(0, 10);

  // Create .wiki_ignore with common project-agnostic patterns
  const wikiIgnore = join(cwd, IGNORE_FILE);
  if (!existsSync(wikiIgnore)) {
    await writeFile(wikiIgnore, `# .wiki_ignore — files/dirs excluded from staleness detection\n# Add project-specific patterns below. Lines starting with # are comments.\n\n# Wiki self-ignore — wiki edits don't trigger staleness\ndocs/wiki/\n\n# Common build/dependency/cache directories\nnode_modules/\ndist/\nbuild/\n.next/\n.cache/\n__pycache__/\n.DS_Store\n`, "utf8");
  }

  // Why: link typed folders only when they exist — empty ones trip W5, and
  // wiki_note_* creates them (plus their index.md) on demand.
  const typedLinks = [
    ["decisions", "Decisions", "Major decisions and direction shifts (ADRs)"],
    ["rules", "Rules", "Reusable heuristics, guidelines, and conventions"],
    ["learnings", "Learnings", "Captured learnings and insights"],
    ["preferences", "Preferences", "Captured preferences and conventions"],
  ]
    .filter(([d]) => existsSync(join(root, String(d))))
    .map(([d, t, desc]) => `- [${t}](./${d}/) — ${desc}`)
    .join("\n");
  await writeFile(
    join(root, "index.md"),
    `${indexFrontmatter()}# Project Knowledge Wiki\n\nAn [OKF](https://github.com/earendil-works/okf) bundle documenting this project.\n\n- [Overview](./overview.md) — What this project contains and its structure\n- [File tree](./architecture/file-tree.md) — Complete project file listing\n- [Glossary](./glossary.md) — Key terms for this project\n${typedLinks ? typedLinks + "\n" : ""}- [Pages](./pages/) — Concepts, entities, and artifacts of this project\n`,
    "utf8",
  );
  await writeFile(join(root, "overview.md"), `${buildFrontmatter({ type: "System Overview", title: "Overview", description: "What this project contains and its structure.", timestamp: now })}\n# Overview\n\n_Describe the project here._\n`, "utf8");
  await writeFile(join(root, "log.md"), `# Update Log\n\n## ${day}\n- **Creation**: Initial OKF bundle scaffolded by /wiki:init.\n`, "utf8");
  await writeFile(join(root, LAST_UPDATED), `# Last wiki sync\n\n${now}\n`, "utf8");
  await writeFile(join(root, "glossary.md"), `${buildFrontmatter({ type: "Glossary", title: "Glossary", description: "Key terms for this project.", timestamp: now })}\n# Glossary\n\n| Term | Definition |\n|------|------------|\n| _term_ | _definition_ |\n`, "utf8");
  await writeFile(join(root, "pages", "index.md"), `# Pages\n\nKnowledge graph: concepts, entities, and artifacts that make up this project.\n\n- [Concepts](./concepts/) — Abstract ideas, definitions, and categories\n- [Entities](./entities/) — Concrete named things, systems, tools, and records\n- [Artifacts](./artifacts/) — Documents, diagrams, code files, and deliverables\n`, "utf8");
  await writeFile(join(root, "pages", "concepts", "index.md"), `# Concepts\n\n_Abstract ideas and definitions will be listed here._\n`, "utf8");
  await writeFile(join(root, "pages", "entities", "index.md"), `# Entities\n\n_Concrete named things will be listed here._\n`, "utf8");
  await writeFile(join(root, "pages", "artifacts", "index.md"), `# Artifacts\n\n_Documents, diagrams, and deliverables will be listed here._\n`, "utf8");

  // Template reference for page authors
  const templatesContent = `---
type: Concept
title: Page Templates
description: Reference templates for Concept, Entity, and Artifact pages. Follow these when using wiki_note_page.
timestamp: ${now}
---
# Page Templates

Use these when documenting the projectbase with \`wiki_note_page\`. Each type has
a stable structure so pages are consistent, skimmable, and well-linked.

## Concept (abstract ideas, definitions, patterns, categories)

\`\`\`markdown
## What is it?
[One paragraph — clear definition the team can agree on.]

## Why does it matter?
[What problem it solves, what depends on it, or what would break without it.]

## Key rules / properties
- [Characteristic or invariant]
- [Edge case to watch for]

## Relationships
- [[entity-that-implements-this]] — how
- [[related-concept]] — how

## Source
- \\\`path/to/file.ts\\\` — implements or references this concept
\`\`\`

## Entity (concrete named things: endpoints, services, models, tools)

\`\`\`markdown
## What is it?
[Concrete thing — what it IS, where it lives.]

## Why does it matter?
[Its role in the system, who/what depends on it.]

## Details
- **Location**: \\\`path/to/file\\\`
- **Interface / Schema**: [key fields, methods, routes, or shape]
- **Configuration**: [env vars, flags, settings]

## Relationships
- [[concept-it-implements]] — what abstract idea this instantiates
- [[entity-it-depends-on]] — dependency or peer

## Lifecycle
- First added: [when, why]
- Significant changes: [date — what changed]
\`\`\`

## Artifact (deliverables: diagrams, reports, specs, configs, screenshots)

\`\`\`markdown
## What is it?
[Document, diagram, report, or file — what it contains.]

## What it documents
- [[entity-or-concept]] — what this artifact describes or supports

## Details
- **Format**: [diagram type, file format, tool used]
- **Location**: \\\`path/to/file\\\`

## Source
- Generated from: [what data, process, or session produced it]
\`\`\`
`;
  await writeFile(join(root, "pages", "TEMPLATES.md"), templatesContent, "utf8");

  // Generate file tree
  const archDir = join(root, "architecture");
  await mkdir(archDir, { recursive: true });
  const { patterns } = await loadIgnore(cwd);
  // Why: file-tree.md must be born conformant — a bare tree body fails E1
  // (no frontmatter) and W1 (no title/description in the nav map).
  const tree = await generateFileTree(cwd, patterns);
  await writeFile(
    join(archDir, "file-tree.md"),
    `${buildFrontmatter({ type: "Artifact", title: "File tree", description: "Complete project file listing with per-file descriptions.", timestamp: now })}\n${tree}`,
    "utf8",
  );

  // Ask LLM to auto-generate overview + glossary + file tree descriptions
  try {
    const scan = await scanProjectContents(cwd);
    const llmPrompt = `I've scanned the project at "${cwd}". Based on the summary below, write content for a knowledge wiki (docs/wiki/) that documents this project.\n\nProject profile:\n${JSON.stringify(scan, null, 2)}\n\nAlso fill in the [] description placeholders for each entry in this file tree.\n\nOutput exactly this format:\n\n## Overview\n(2-4 paragraphs describing the project's contents and organization)\n\n## Glossary\n| Term | Definition |\n|------|------------|\n\n## File tree descriptions\npath — description\npath — description`;

    // This hidden LLM turn triggers its own agent_end — suppress the recap for it.
    suppressRecap = true;
    const result = await askLLM(llmPrompt, 30000);

    // Parse result — extract Overview, Glossary, and File tree descriptions sections
    const overviewMatch = result.match(/## Overview\n([\s\S]*?)(?=\n## )/);
    const glossaryMatch = result.match(/## Glossary\n([\s\S]*?)(?=\n## |$)/);
    const treeMatch = result.match(/## File tree descriptions\n([\s\S]*?)$/);

    if (overviewMatch) {
      const overviewContent = overviewMatch[1].trim();
      await writeFile(join(root, "overview.md"), `${buildFrontmatter({ type: "System Overview", title: "Overview", description: "What this project contains and its structure.", timestamp: new Date().toISOString() })}\n# Overview\n\n${overviewContent}\n`, "utf8");
    }

    if (glossaryMatch) {
      const glossaryContent = glossaryMatch[1].trim();
      await writeFile(join(root, "glossary.md"), `${buildFrontmatter({ type: "Glossary", title: "Glossary", description: "Key terms for this project.", timestamp: new Date().toISOString() })}\n# Glossary\n\n${glossaryContent}\n`, "utf8");
    }

    if (treeMatch) {
      const treeDescriptions = treeMatch[1].trim();
      // Apply descriptions to file-tree.md — replace [] with descriptions
      let currentTree = await readFile(join(archDir, "file-tree.md"), "utf8");
      const lines = currentTree.split("\n");
      const descMap = new Map<string, string>();
      for (const line of treeDescriptions.split("\n")) {
        const m = line.match(/^(.+?)\s*[—\-]\s*(.+)$/);
        if (m) descMap.set(m[1].trim(), m[2].trim());
      }
      const newLines = lines.map((l) => {
        const m = l.match(/^(.*)(\[])$/);
        if (m) {
          const bare = m[1].replace(/[├└──│ ]/g, "").trim();
          const desc = descMap.get(bare) || "";
          return l.replace("[]", desc ? `[${desc}]` : "");
        }
        return l;
      });
      await writeFile(join(archDir, "file-tree.md"), newLines.join("\n"), "utf8");
    }
  } catch (e) {
    // LLM auto-documentation is best-effort — stubs remain if it fails
    console.error("wiki auto-document failed:", e instanceof Error ? e.message : String(e));
  }

  // Build the detailed nav map into index.md last so it reflects any LLM-written titles/descriptions.
  await updateIndexNavMap(cwd);
  await regenerateMemory(cwd);
}

function indexFrontmatter(): string {
  return `---\nokf_version: "0.1"\n---\n\n`;
}

// ---------------------------------------------------------------------------
// File tree generator
// ---------------------------------------------------------------------------

async function generateFileTree(cwd: string, patterns: string[]): Promise<string> {
  const now = new Date().toISOString();
  let out = `# File tree — generated ${now}\n`
    + `# Respects .wiki_ignore exclusions.\n`
    + `# [description] — shorthand summary of each file's function\n\n.\n`;

  async function walk(dir: string, prefix: string, depth = 0) {
    // ponytail: cap recursion to prevent stack overflow on pathological trees
    if (depth > 50) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Filter + sort: dirs first, then alphabetically
    entries = entries.filter((e) => {
      const rel = relative(cwd, join(dir, e.name)).replace(/\\/g, "/");
      return !isIgnored(rel, patterns);
    }).sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      // Append a placeholder [description] marker — the LLM fills these in
      const suffix = e.isDirectory() ? "/" : "";
      out += `${prefix}${connector}${e.name}${suffix} []\n`;
      if (e.isDirectory()) {
        await walk(
          join(dir, e.name),
          prefix + (isLast ? "    " : "│   "),
        );
      }
    }
  }

  await walk(cwd, "", 0);
  return out;
}

// ---------------------------------------------------------------------------
// Detailed navigation map (the LLM's "where to find what" index)
// ---------------------------------------------------------------------------

// Markers delimit the auto-generated nav section inside index.md so the map
// can be regenerated (init / wiki_mark_synced) without clobbering hand-edited
// prose elsewhere in the file.
const NAV_START = "<!-- wiki-nav:start -->";
const NAV_END = "<!-- wiki-nav:end -->";

/**
 * Build the body of the detailed nav map: every docs/wiki/ concept grouped by
 * folder, each entry shows concept id (for wiki_get), title, and description.
 * Body only — wrapped with NAV markers and merged into index.md by
 * updateIndexNavMap. Regenerated on init and on wiki_mark_synced.
 */
async function generateNavMap(cwd: string): Promise<string> {
  const root = wikiDir(cwd);
  const now = new Date().toISOString();
  if (!existsSync(root)) return "";
  const files = await walkMd(root);
  const entries: { rel: string; group: string; title: string; desc: string }[] = [];
  for (const f of files) {
    const base = basename(f);
    if (RESERVED.has(base)) continue; // skip auto-indices + last_updated
    const rel = relative(root, f).replace(/\\/g, "/").replace(/\.md$/, "");
    const text = await readFile(f, "utf8");
    const { yaml } = parseFrontmatter(text);
    const slash = rel.indexOf("/");
    const group = slash >= 0 ? rel.slice(0, slash) : "root";
    const title = yaml.title ? String(yaml.title) : rel;
    const desc = yaml.description ? String(yaml.description) : "";
    entries.push({ rel, group, title, desc });
  }
  const byGroup: Record<string, typeof entries> = {};
  for (const e of entries) (byGroup[e.group] ??= []).push(e);
  const order = ["root", "architecture", "glossary", "pages", "decisions", "rules", "learnings", "preferences", "docs", "changelog"];
  const groups = Object.keys(byGroup).sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
  });
  const lines: string[] = [
    "Auto-generated detailed index of every docs/wiki/ concept — the map the LLM uses to locate information. "
      + `${entries.length} concept(s). Regenerated on init and on wiki_mark_synced. Generated ${now}.`,
    "",
    "Each entry: [title](concept-id.md) — description. Links are clickable in /wiki; pass the concept-id (link target minus .md) to wiki_get.",
    "",
  ];
  for (const g of groups) {
    const label = g === "root" ? "Core concepts" : g.charAt(0).toUpperCase() + g.slice(1);
    lines.push(`### ${label}`, "");
    for (const e of byGroup[g].sort((a, b) => a.rel.localeCompare(b.rel))) {
      lines.push(`- [${e.title}](${e.rel}.md)${e.desc ? ` — ${e.desc}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Merge the current nav map into index.md as a "## Navigation map" section
 * delimited by NAV markers. Preserves any content outside the markers (e.g.
 * hand-written intro/quick-links). Inserts the section after the H1 title if
 * no markers exist yet. Safe to call on a freshly-init'd index.md.
 */
export async function updateIndexNavMap(cwd: string): Promise<void> {
  const indexPath = join(wikiDir(cwd), "index.md");
  const body = await generateNavMap(cwd);
  const section = `${NAV_START}\n## Navigation map\n\n${body.trimEnd()}\n${NAV_END}`;
  let existing = existsSync(indexPath) ? await readFile(indexPath, "utf8") : "";
  if (existing.includes(NAV_START) && existing.includes(NAV_END)) {
    // Replace the existing marked section (non-greedy, dotall via [\s\S]).
    existing = existing.replace(
      new RegExp(`${NAV_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${NAV_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      section,
    );
  } else {
    // First insertion: place after the first H1 ("# Title") so the map sits
    // high in the file where the LLM sees it immediately. Fallback: prepend.
    const h1End = existing.match(/^# .*(\r?\n)/m);
    if (h1End && h1End.index !== undefined) {
      const insertAt = h1End.index + h1End[0].length;
      existing = existing.slice(0, insertAt) + "\n" + section + "\n" + existing.slice(insertAt);
    } else {
      existing = `${section}\n\n${existing}`;
    }
  }
  await writeFile(indexPath, existing.replace(/\n{3,}/g, "\n\n"), "utf8");
}

// ---------------------------------------------------------------------------
// memory.md — always-injected live contract
// ---------------------------------------------------------------------------

interface MemoryEntry {
  rel: string;
  title: string;
  desc: string;
  ts: number;
}

async function collectMemoryEntries(root: string, folder: string): Promise<MemoryEntry[]> {
  const dir = join(root, folder);
  if (!existsSync(dir)) return [];
  const out: MemoryEntry[] = [];
  for (const f of await walkMd(dir)) {
    if (basename(f) === "index.md") continue;
    let text: string;
    try {
      text = await readFile(f, "utf8");
    } catch {
      continue;
    }
    const { yaml } = parseFrontmatter(text);
    const rel = relative(root, f).replace(/\\/g, "/").replace(/\.md$/, "");
    out.push({
      rel,
      title: yaml.title ? String(yaml.title) : rel,
      desc: yaml.description ? String(yaml.description) : "",
      ts: yaml.timestamp ? Date.parse(String(yaml.timestamp)) || 0 : 0,
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

function memorySection(label: string, entries: MemoryEntry[], cap: number): string[] {
  if (!entries.length) return [];
  const lines = [`## ${label}`, ""];
  for (const e of entries.slice(0, cap)) {
    const day = e.ts ? ` (${new Date(e.ts).toISOString().slice(0, 10)})` : "";
    const desc = e.desc.length > 140 ? `${e.desc.slice(0, 140)}…` : e.desc;
    lines.push(`- [${e.title}](${e.rel}.md)${desc ? ` — ${desc}` : ""}${day}`);
  }
  lines.push("");
  return lines;
}

/** Regenerate docs/wiki/memory.md — the always-injected digest of the most
 *  recent decisions, rules, conventions, development patterns, architecture,
 *  and global patterns. Bodies live in the wiki; memory.md only indexes them. */
export async function regenerateMemory(cwd: string): Promise<void> {
  const root = wikiDir(cwd);
  if (!existsSync(root)) return;
  const [decisions, rules, prefs, learnings, arch, concepts] = await Promise.all([
    collectMemoryEntries(root, "decisions"),
    collectMemoryEntries(root, "rules"),
    collectMemoryEntries(root, "preferences"),
    collectMemoryEntries(root, "learnings"),
    collectMemoryEntries(root, "architecture"),
    collectMemoryEntries(root, join("pages", "concepts")),
  ]);
  const lines: string[] = [
    MEMORY_START,
    "# Memory — the live contract",
    "",
    "Auto-generated digest of the most recent conventions, decisions, rules and",
    "development patterns, plus architecture and global patterns — newest first.",
    "The actual files live in the wiki subfolders; follow the links (clickable in /wiki).",
    `Regenerated on every wiki write and on wiki_mark_synced. Generated ${new Date().toISOString()}.`,
    "",
  ];
  lines.push(...memorySection("Recent Decisions", decisions, 15));
  lines.push(...memorySection("Active Rules", rules, 25));
  lines.push(...memorySection("Preferences & Conventions", prefs, 15));
  lines.push(...memorySection("Recent Learnings — development patterns", learnings, 20));
  lines.push(...memorySection("Architecture", arch, 12));
  lines.push(...memorySection("Global Patterns", concepts, 15));
  lines.push(MEMORY_END);
  await writeFile(join(root, MEMORY_FILE), `${indexFrontmatter()}${lines.join("\n")}\n`, "utf8");
}

// ---------------------------------------------------------------------------
// Content-blind project scanner (agnostic — no codebase assumptions)
// ---------------------------------------------------------------------------

interface ProjectScan {
  topLevel: string[];
  extensions: Record<string, number>;
  totalFiles: number;
  totalDirs: number;
  totalHidden: number;
  maxDepth: number;
}

async function scanProjectContents(cwd: string): Promise<ProjectScan> {
  const topLevel: string[] = [];
  const extensions: Record<string, number> = {};
  let totalFiles = 0;
  let totalDirs = 0;
  let totalHidden = 0;
  let maxDepth = 0;

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) maxDepth = depth;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (depth === 0) {
        topLevel.push(`${e.name}${e.isDirectory() ? " (dir)" : " (file)"}`);
      }
      if (e.name.startsWith(".")) totalHidden++;

      if (e.isDirectory()) {
        totalDirs++;
        await walk(join(dir, e.name), depth + 1);
      } else {
        totalFiles++;
        const ext = extname(e.name).toLowerCase();
        if (ext) extensions[ext] = (extensions[ext] || 0) + 1;
      }
    }
  }

  await walk(cwd, 0);
  return { topLevel, extensions, totalFiles, totalDirs, totalHidden, maxDepth };
}

// ---------------------------------------------------------------------------
// Extension entry
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pending LLM prompts (for init auto-documentation)
// ---------------------------------------------------------------------------

const pendingPrompts = new Map<string, {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

async function askLLM(prompt: string, timeoutMs = 20000, customType = "wiki-init-prompt"): Promise<string> {
  const id = `wiki-${customType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingPrompts.delete(id);
      reject(new Error("LLM prompt timed out"));
    }, timeoutMs);
    pendingPrompts.set(id, { resolve, reject, timeout });
    getApi().pi.sendMessage(
      {
        customType,
        content: prompt,
        display: false,
      },
      { triggerTurn: true, deliverAs: "followUp" },
    );
  });
}

export default function (pi: ExtensionAPI) {
  // Linked worktree: reads work (the wiki is committed — it travels with the
  // branch), writes refuse (single source of truth in the main checkout; stray
  // background writes in worktrees caused stash/pull conflicts). Computed once
  // at load; pi's process cwd is fixed for the session.
  // ponytail: sync execSync at load time; if sessions ever chdir mid-run,
  // re-check per-event.
  try {
    const gd = (a: string) =>
      resolve(execSync(`git rev-parse --path-format=absolute ${a}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim());
    IS_WORKTREE = gd("--git-dir") !== gd("--git-common-dir");
  } catch {
    IS_WORKTREE = false; // not a git repo — init normally
  }

  _api = pi;

  // --- message_end: capture LLM responses for pending prompts ---
  pi.on("message_end", async (event, _ctx) => {
    // ponytail: skip processing if no pending init prompts
    if (pendingPrompts.size === 0) return;
    if (event.message.role !== "assistant") return;
    const text = (event.message.content as Array<{ type: string; text?: string }> | undefined)
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (!text) return;

    const first = pendingPrompts.entries().next();
    if (!first.done) {
      const [, entry] = first.value;
      clearTimeout(entry.timeout);
      entry.resolve(text);
      pendingPrompts.delete(first.value[0]);
    }
  });

  // --- session_start: ensure bundle, run staleness check, ask to update ---
  pi.on("session_start", async (_event, ctx) => {
    // ctx is used after awaits below (initBundle, staleness confirm dialog that
    // can stay open across a session switch) — staleSafeCtx prevents a stale
    // ctx from crashing pi.
    ctx = staleSafeCtx(ctx);
    if (!ctx.isProjectTrusted()) return;
    const cwd = ctx.cwd;

    // Worktree: read-only mode. No init offer, no staleness curation (writes
    // are impossible here); injection still works via before_agent_start.
    if (IS_WORKTREE) {
      ctx.ui.setStatus(FOOTER_KEY, `wiki: ${ctx.ui.theme.fg("warning", "●")} read-only (worktree)`);
      return;
    }

    // Ask before first init; remember declines so we never re-ask (unless
    // /wiki:init is run explicitly). Headless can't ask → do nothing.
    if (!existsSync(wikiDir(cwd))) {
      if (!ctx.hasUI) return;
      const omitted = loadOmitted();
      if (omitted.includes(cwd)) return; // declined earlier — stay quiet
      const ok = await ctx.ui.confirm(
        "Enable wiki?",
        `Add wiki features (docs/wiki/) to this folder?`,
      );
      if (!ok) {
        omitted.push(cwd);
        saveOmitted(omitted);
        ctx.ui.notify("Wiki skipped for this folder. Run /wiki:init anytime to enable it.", "info");
        return;
      }
      try {
        await initBundle(cwd);
        ctx.ui.notify("Created docs/wiki/ stub bundle. Run /wiki:init to re-scaffold.", "info");
      } catch (e) {
        ctx.ui.notify(`wiki init failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
      return; // nothing to check yet
    }

    // Defer slightly so UI is ready and we don't block startup.
    try {
      await runStalenessCheck(ctx);
    } catch (e) {
      if (ctx.hasUI) ctx.ui.notify(`wiki check failed: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  });

  // --- before_agent_start: inject the wiki-first lookup rule + nav map ---
  // systemPrompt is per-turn (rebuilt each turn), so we re-apply the injection
  // unless the sentinel is already present — either carried in this turn's
  // chained systemPrompt, or persisted in a prior session message (resume).
  pi.on("before_agent_start", async (event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    if (!existsSync(wikiDir(ctx.cwd))) return;
    const sys = (event.systemPrompt ?? "");
    if (sys.includes(SENTINEL) || markerInBranch(ctx)) return; // already in context
    const injection = await buildInjection(ctx.cwd);
    if (!injection) return;
    return {
      systemPrompt: sys + "\n\n" + injection,
    };
  });

  // --- agent_start / compaction_start: cancel any pending debounced recap ---
  // agent_end fires once per agent RUN; a prompt can chain several runs
  // (prompt -> continue for steer/retry/compaction/queued msgs). Each continue
  // begins with agent_start, so cancelling here means only the FINAL agent_end
  // of the prompt spawns the recap. compaction_start likewise precedes a
  // continue, so it cancels too.
  pi.on("agent_start", async () => { clearRecapTimer(); });
  pi.on("compaction_start", async () => { clearRecapTimer(); });

  // --- agent_end: debounced fire-and-forget wiki-recap subagent ---
  // Schedules (does not immediately spawn) the wiki-recap agent. The spawn is
  // cancelled if a continuation follows (see agent_start / compaction_start
  // above), so it only fires when the full turn is done. Skips hidden/internal
  // turns (suppressRecap) and trivial turns (<80 chars). Dynamic import +
  // graceful fallback if intelligent-delegation or the wiki-recap agent is
  // unavailable.
  pi.on("agent_end", async (event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    if (!existsSync(wikiDir(ctx.cwd))) return;
    // Worktree: recap writes to the wiki — refuse (main checkout only).
    if (IS_WORKTREE) return;
    // Headless/print/JSON/RPC mode (incl. all delegated subagents) — never recap.
    // This is also the recursion guard: spawned children skip this path instead
    // of spawning recaps of their own. (hasUI is TRUE in RPC children — ui
    // requests go over stdout — so the rpc check is required, not optional.)
    if (!ctx.hasUI || ctx.mode === "rpc") return;
    // Skip recap for hidden/internal turns we dispatched ourselves (init
    // auto-doc, staleness delegation steer). Checked + cleared here.
    if (suppressRecap) { suppressRecap = false; return; }
    const ev = event as { messages?: Array<{ message?: { role?: string; content?: unknown } } | { role?: string; content?: unknown }> };
    const turnText = collectTurnText(ev.messages ?? []);
    // ponytail: skip trivial turns — not worth a subprocess spawn.
    if (turnText.trim().length < 80) return;
    // notify fires 1.2s+ after this hook returns (debounce + subagent runtime);
    // by then the session may have been replaced/reloaded — staleSafeCtx keeps
    // the stale throw from crashing pi.
    const notify = (msg: string, type?: "info" | "warning" | "error") => staleSafeCtx(ctx).ui.notify(msg, type);
    scheduleRecap(ctx.cwd, turnText, parentModelRef(ctx), notify);
  });

  // -------------------------------------------------------------------------
  // Tools
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "wiki_get",
    label: "Wiki Get",
    description:
      "Read an OKF concept from docs/wiki/ by id/path (e.g. 'domains/wiki', 'architecture/tech-stack'). Returns frontmatter + body, plus the referenced source file (resource:) if present (truncated). Lazy-load; do not read the whole bundle.",
    promptSnippet: "Read a docs/wiki/ concept by id/path",
    promptGuidelines: [
      "Use wiki_get to load a single docs/wiki/ concept when you need its detail, instead of reading files blindly.",
    ],
    parameters: Type.Object({
      concept: Type.String({ description: "Concept id or path, e.g. 'domains/wiki' or 'architecture/tech-stack'" }),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      const cwd = ctx.cwd;
      const found = await readConcept(cwd, params.concept);
      if (!found) {
        return {
          content: [{ type: "text" as const, text: `Not found: ${params.concept}. Call wiki_search to discover concepts.` }],
        };
      }
      let out = `# ${relative(wikiDir(cwd), found.path).replace(/\\/g, "/")}\n\n${found.text}`;
      const { yaml } = parseFrontmatter(found.text);
      const res = resourcePath(yaml);
      if (res) {
        const rp = resolve(cwd, res);
        if (existsSync(rp)) {
          try {
            const raw = await readFile(rp, "utf8");
            const truncated = raw.split("\n").slice(0, RESOURCE_TRUNCATE).join("\n");
            out += `\n\n## Referenced resource: ${res}\n\n\`\`\`\n${truncated}${raw.split("\n").length > RESOURCE_TRUNCATE ? "\n... (truncated)" : ""}\n\`\`\``;
          } catch {
            out += `\n\n_(resource ${res} unreadable)_`;
          }
        } else {
          out += `\n\n_(resource ${res} not found)_`;
        }
      }
      return { content: [{ type: "text" as const, text: out }] };
    },
  });

  pi.registerTool({
    name: "wiki_search",
    label: "Wiki Search",
    description: "Keyword search across all docs/wiki/ concepts. Returns a ranked list of path, description, and first matching line (top 15).",
    promptSnippet: "Keyword search across docs/wiki/ concepts",
    parameters: Type.Object({
      query: Type.String({ description: "Search query (case-insensitive substring)" }),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      const cwd = ctx.cwd;
      const root = wikiDir(cwd);
      const q = params.query.toLowerCase();
      const files = await walkMd(root);
      const hits: { rel: string; desc: string; line: string; score: number }[] = [];
      for (const f of files) {
        if (RESERVED.has(basename(f))) continue;
        const rel = relative(root, f).replace(/\.md$/, "").replace(/\\/g, "/");
        const text = await readFile(f, "utf8");
        const { yaml } = parseFrontmatter(text);
        const desc = (yaml.description ? String(yaml.description) : "").trim();
        const lower = text.toLowerCase();
        const inTitle = (yaml.title ? String(yaml.title).toLowerCase() : "").includes(q) ? 3 : 0;
        const inPath = rel.toLowerCase().includes(q) ? 2 : 0;
        const idx = lower.indexOf(q);
        if (inTitle || inPath || idx >= 0) {
          const line =
            idx >= 0
              ? text.slice(Math.max(0, idx - 40), idx + q.length + 40).replace(/\n/g, " ")
              : "";
          hits.push({ rel, desc, line, score: inTitle * 3 + inPath * 2 + (idx >= 0 ? 1 : 0) });
        }
      }
      hits.sort((a, b) => b.score - a.score);
      const top = hits.slice(0, 15);
      if (top.length === 0)
        return { content: [{ type: "text" as const, text: `No concepts match "${params.query}".` }] };
      const body = top
        .map((h) => `- ${h.rel}${h.desc ? ` — ${h.desc}` : ""}${h.line ? `\n    …${h.line}…` : ""}`)
        .join("\n");
      return { content: [{ type: "text" as const, text: `${top.length} concept(s) match "${params.query}":\n\n${body}` }] };
    },
  });

  pi.registerTool({
    name: "wiki_related",
    label: "Wiki Related",
    description: "List the concepts cross-linked from a given docs/wiki/ concept, with each linked concept's title and description.",
    promptSnippet: "Follow cross-links from a docs/wiki/ concept",
    parameters: Type.Object({
      concept: Type.String({ description: "Concept id or path" }),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      const cwd = ctx.cwd;
      const found = await readConcept(cwd, params.concept);
      if (!found) return { content: [{ type: "text" as const, text: `Not found: ${params.concept}` }] };
      const links = extractLinks(parseFrontmatter(found.text).body);
      const rows: string[] = [];
      for (const link of links) {
        const target = await readConcept(cwd, link);
        if (!target) {
          rows.push(`- ${link} — (not yet written)`);
          continue;
        }
        const { yaml } = parseFrontmatter(target.text);
        const t = yaml.title ? String(yaml.title) : link;
        const d = yaml.description ? String(yaml.description) : "";
        rows.push(`- ${link}${t ? ` — ${t}` : ""}${d ? ` — ${d}` : ""}`);
      }

      // ponytail: scan for backlinks — any page in docs/wiki/ that links TO params.concept
      let backlinks: string[] = [];
      const targetRel = params.concept.replace(/^@/, "").replace(/\.md$/, "");
      const pagesDir = join(wikiDir(cwd), "pages");
      if (existsSync(pagesDir)) {
        const allMd = await walkMd(pagesDir);
        for (const f of allMd) {
          const base = basename(f);
          if (base === "index.md") continue;
          const text = await readFile(f, "utf8");
          const rel = relative(wikiDir(cwd), f).replace(/\\/g, "/").replace(/\.md$/, "");
          if (rel === targetRel) continue; // don't self-link
          // Check if this page's body links TO our concept (via markdown link or wikilink)
          const { body, yaml: byaml } = parseFrontmatter(text);
          const linkTarget = `./${targetRel.replace(/^pages\//, "").replace(/^(concepts|entities|artifacts)\//, "")}.md`;
          const linkRe = new RegExp(`\\(${linkTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)|\\[\\[${targetRel.replace(/^pages\//, "").replace(/^(concepts|entities|artifacts)\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`);
          if (linkRe.test(body) || body.includes(targetRel)) {
            const blTitle = byaml.title ? String(byaml.title) : rel;
            backlinks.push(`- ${rel} — ${blTitle}`);
          }
        }
      }

      let output = rows.length ? `Related to ${params.concept}:\n\n${rows.join("\n")}` : `No cross-links in ${params.concept}.`;
      if (backlinks.length) {
        output += `\n\nBacklinks (pages that link here):\n\n${backlinks.join("\n")}`;
      }
      return {
        content: [{ type: "text" as const, text: output }],
      };
    },
  });

  pi.registerTool({
    name: "wiki_note_learning",
    label: "Note Learning",
    description: "Record a learning into docs/wiki/learnings/ as an OKF concept (type: Learning). Auto-generates frontmatter and updates learnings/index.md. Use whenever you discover something worth remembering about this project.",
    promptSnippet: "Record a learning to docs/wiki/learnings/",
    promptGuidelines: [
      "Use wiki_note_learning when you discover a non-obvious fact, gotcha, or working method about this project worth persisting for future sessions.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the learning" }),
      body: Type.String({ description: "Learning details (markdown)" }),
      tags: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      return noteInto(ctx.cwd, "learnings", "Learning", params.title, params.body, params.tags);
    },
  });

  pi.registerTool({
    name: "wiki_note_preference",
    label: "Note Preference",
    description: "Record a preference/convention into docs/wiki/preferences/ as an OKF concept (type: Preference). Auto-generates frontmatter and updates preferences/index.md. Use for coding style, tool choices, conventions the user states.",
    promptSnippet: "Record a preference to docs/wiki/preferences/",
    promptGuidelines: [
      "Use wiki_note_preference when the user states or you infer a durable coding style, tool, or convention preference for this project.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the preference" }),
      body: Type.String({ description: "Preference details (markdown)" }),
      tags: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      return noteInto(ctx.cwd, "preferences", "Preference", params.title, params.body, params.tags);
    },
  });

  pi.registerTool({
    name: "wiki_note_decision",
    label: "Note Decision",
    description:
      "Record a major decision or direction shift into docs/wiki/decisions/ as an OKF concept (type: Decision). Auto-generates frontmatter and updates decisions/index.md. Use for architecture choices, technology/library changes, approach pivots, replacing one strategy with another, or deprecations. Captures the WHY so future sessions understand the code's shape.",
    promptSnippet: "Record a major decision/direction shift to docs/wiki/decisions/",
    promptGuidelines: [
      "Use wiki_note_decision when a MAJOR decision or direction shift is made or discussed: an architecture choice, a technology or library change, an approach pivot, replacing one strategy with another, a deprecation. NOT for routine task progress.",
      "A good decision record names the choice, the alternatives considered, and the rationale (why this over the alternatives).",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the decision (e.g. 'Use server-side sessions over JWT')" }),
      body: Type.String({ description: "Decision details (markdown): context, the choice, alternatives considered, rationale, consequences." }),
      status: Type.Optional(StringEnum(["proposed", "accepted", "superseded", "deprecated"], { description: "Decision status (default: accepted)" })),
      supersedes: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], { description: "Concept id(s) this decision supersedes" })),
      tags: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      const extra: Record<string, unknown> = { status: params.status ?? "accepted" };
      if (params.supersedes) extra.supersedes = params.supersedes;
      return noteInto(ctx.cwd, "decisions", "Decision", params.title, params.body, params.tags, extra);
    },
  });

  pi.registerTool({
    name: "wiki_note_rule",
    label: "Note Rule",
    description:
      "Record a reusable heuristic, guideline, or convention into docs/wiki/rules/ as an OKF concept (type: Rule). Auto-generates frontmatter and updates rules/index.md. Use for working methods, \"always do X\" insights, gotchas, coding conventions, or any reusable rule the team should follow.",
    promptSnippet: "Record a reusable rule/heuristic to docs/wiki/rules/",
    promptGuidelines: [
      "Use wiki_note_rule when a reusable heuristic, guideline, or convention emerges: a working method, an \"always do X\" insight, a gotcha to avoid, a coding convention. NOT for one-off task fixes.",
      "A good rule names the guideline, when it applies, and the rationale or evidence behind it.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the rule (e.g. 'Always validate at trust boundaries')" }),
      body: Type.String({ description: "Rule details (markdown): the guideline, when it applies, rationale/evidence." }),
      tags: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      return noteInto(ctx.cwd, "rules", "Rule", params.title, params.body, params.tags);
    },
  });

  pi.registerTool({
    name: "wiki_note_page",
    label: "Note Page",
    description:
      "Record a Concept, Entity, or Artifact page into docs/wiki/pages/. "
      + "Concepts define vocabulary and categories. Entities are concrete named things. "
      + "Artifacts are supporting deliverables. Use [[slug]] wikilinks in body to link between pages. "
      + "Auto-generates frontmatter, converts wikilinks, and updates relevant indexes.",
    promptSnippet: "Record a project page (Concept, Entity, Artifact) into docs/wiki/pages/",
    promptGuidelines: [
      "Use wiki_note_page to document projectbase concepts, entities, and artifacts.",
      "Follow the page templates below. Keep pages short but well-linked: definition up top, then examples, then relationships, then sources.",
      "",
      "## Concept template — abstract ideas, definitions, patterns, categories",
      "```markdown",
      "## What is it?",
      "[One paragraph — clear definition the team can agree on.]",
      "",
      "## Why does it matter?",
      "[What problem it solves, what depends on it, or what would break without it.]",
      "",
      "## Key rules / properties",
      "- [Characteristic or invariant]",
      "- [Edge case to watch for]",
      "",
      "## Relationships",
      "- [[entity-that-implements-this]] — how",
      "- [[related-concept]] — how",
      "",
      "## Source",
      "- `path/to/file.ts` — implements or references this concept",
      "```",
      "",
      "## Entity template — concrete named things: endpoints, services, models, tools, configs",
      "```markdown",
      "## What is it?",
      "[Concrete thing — what it IS, where it lives.]",
      "",
      "## Why does it matter?",
      "[Its role in the system, who/what depends on it.]",
      "",
      "## Details",
      "- **Location**: `path/to/file`",
      "- **Interface / Schema**: [key fields, methods, routes, or shape]",
      "- **Configuration**: [env vars, flags, settings that control it]",
      "",
      "## Relationships",
      "- [[concept-it-implements]] — what abstract idea this instantiates",
      "- [[entity-it-depends-on]] — dependency or peer",
      "",
      "## Lifecycle",
      "- First added: [when, why]",
      "- Significant changes: [date — what changed]",
      "```",
      "",
      "## Artifact template — deliverables: diagrams, reports, specs, configs, screenshots",
      "```markdown",
      "## What is it?",
      "[Document, diagram, report, or file — what it contains.]",
      "",
      "## What it documents",
      "- [[entity-or-concept]] — what this artifact describes or supports",
      "",
      "## Details",
      "- **Format**: [diagram type, file format, tool used]",
      "- **Location**: `path/to/file`",
      "",
      "## Source",
      "- Generated from: [what data, process, or session produced it]",
      "```",
      "",
      "Use [[slug]] wikilinks in body to cross-link pages — they're auto-converted to markdown links.",
    ],
    parameters: Type.Object({
      type: StringEnum(["Concept", "Entity", "Artifact"], { description: "Page type: Concept (abstract idea), Entity (concrete thing), or Artifact (supporting deliverable)" }),
      title: Type.String({ description: "Page title (stable — used as the slug base)" }),
      body: Type.String({ description: "Page content in markdown. Use [[slug]] for wikilinks to other pages." }),
      tags: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      return notePage(ctx.cwd, params.type, params.title, params.body, params.tags);
    },
  });

  pi.registerTool({
    name: "wiki_mark_synced",
    label: "Mark Wiki Synced",
    description: "Bump docs/wiki/last_updated.md to now, signaling the wiki is in sync with the codebase. Clears the staleness footer. Call this after you finish updating the wiki to reflect code changes.",
    promptSnippet: "Bump docs/wiki/last_updated.md after a wiki sync",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const refuse = worktreeWriteRefusal(); if (refuse) return refuse;
      const cwd = ctx.cwd;
      // Gate: refuse to stamp clean while OKF errors exist. Forces fixes this turn
      // instead of letting malformed frontmatter/types accumulate. Warnings pass.
      const pre = await validateBundle(cwd);
      if (pre.errors.length) {
        return {
          content: [{ type: "text" as const,
            text: `Cannot mark synced — ${pre.errors.length} OKF error(s) must be fixed first:\n` +
                  pre.errors.map((e) => `  - ${e}`).join("\n") +
                  `\nFix the frontmatter/type issues above, then call wiki_mark_synced again.` }],
        };
      }
      const now = new Date().toISOString();
      await writeFile(join(wikiDir(cwd), LAST_UPDATED), `# Last wiki sync\n\n${now}\n`, "utf8");
      // Also append a log.md entry.
      try {
        const logP = join(wikiDir(cwd), "log.md");
        let log = existsSync(logP) ? await readFile(logP, "utf8") : `# Update Log\n`;
        const day = now.slice(0, 10);
        const entry = `## ${day}\n- **Update**: Wiki marked synced (${now}).\n`;
        if (log.includes(`## ${day}`)) {
          log = log.replace(`## ${day}`, `${entry.replace(/\n$/, "")}\n\n_older below_\n\n## ${day}`);
        } else {
          log = log.replace(/^(# Update Log)\s*/, `$1\n\n${entry}`);
        }
        await writeFile(logP, log, "utf8");
      } catch {
        /* best effort */
      }
      // Auto-regenerate wiki.js + wiki-viewer.html so files stay fresh
      try {
        const js = await generateWikiDataJs(cwd);
        await writeFile(join(wikiDir(cwd), "wiki.js"), js, "utf8");
        const viewerHtml = await generateWikiViewerHtml(cwd);
        await writeFile(join(wikiDir(cwd), "wiki-viewer.html"), viewerHtml, "utf8");
      } catch {
        // best effort — viewer update is non-critical
      }
      // Regenerate the nav map section inside index.md so the LLM's index reflects the latest sync.
      try {
        await updateIndexNavMap(cwd);
      } catch {
        // best effort — non-critical
      }
      // Regenerate memory.md (always-injected live contract) on the same schedule.
      try {
        await regenerateMemory(cwd);
      } catch {
        // best effort — non-critical
      }
      // ponytail: footer clears on next session_start re-check; no live ctx here to clear it mid-turn.
      return { content: [{ type: "text" as const, text: `Wiki marked synced: ${now}. Staleness footer clears on next session.` }] };
    },
  });

  pi.registerTool({
    name: "wiki_validate",
    label: "Wiki Validate",
    description: "Run the OKF v0.1 conformance check over docs/wiki/. Returns errors (E1–E3: frontmatter/type/type-set) and warnings (W1–W5: title/desc, long filename, bad timestamp, broken link, empty folder).",
    promptSnippet: "Validate docs/wiki/ OKF conformance",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const report = await validateBundle(cwd);
      const lines: string[] = [];
      if (report.errors.length === 0 && report.warnings.length === 0) {
        lines.push("✅ Bundle is OKF v0.1 conformant. No errors or warnings.");
      } else {
        if (report.errors.length) lines.push("Errors:\n" + report.errors.map((e) => `  - ${e}`).join("\n"));
        if (report.warnings.length) lines.push("Warnings:\n" + report.warnings.map((w) => `  - ${w}`).join("\n"));
      }
      return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
    },
  });

  // -------------------------------------------------------------------------
  // New tools
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "wiki_discover",
    label: "Wiki Discover",
    description:
      "List files and directories in the project by path, depth, and extension filter. "
      + "Use to explore undocumented areas of any project — code, spreadsheets, "
      + "emails, images, data, or notes. Does not read file contents.",
    promptSnippet: "Discover files/dirs in the project by path and filter",
    parameters: Type.Object({
      path: Type.String({ description: "Relative path from project root (e.g. 'inbox' or 'templates')", default: "." }),
      depth: Type.Optional(Type.Number({ description: "Recursion depth (1=flat, 5=max)", default: 1, maximum: 5 })),
      filter: Type.Optional(Type.Object({
        extensions: Type.Optional(Type.Array(Type.String(), { description: "Filter by file extension(s), e.g. ['xlsx','csv'] or ['eml']" })),
        type: Type.Optional(StringEnum(["file", "dir", "both"], { default: "both" })),
      })),
      max: Type.Optional(Type.Number({ description: "Max entries to return", default: 100, maximum: 500 })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      const cwd = ctx.cwd;
      const base = resolve(cwd, params.path || ".");
      const maxDepth = params.depth ?? 1;
      const max = params.max ?? 100;
      const filterExts = params.filter?.extensions?.map((e: string) => e.toLowerCase());
      const filterType = params.filter?.type ?? "both";

      const results: { type: string; name: string; path: string; size?: number; entryCount?: number }[] = [];

      async function walk(dir: string, depth: number) {
        if (results.length >= max) return;
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); }
        catch { return; }

        for (const e of entries) {
          if (results.length >= max) break;
          const relPath = relative(cwd, join(dir, e.name)).replace(/\\/g, "/");
          const ext = extname(e.name).toLowerCase().replace(/^\./, "");

          // Apply filters
          if (filterType === "file" && e.isDirectory()) continue;
          if (filterType === "dir" && !e.isDirectory()) continue;
          if (filterExts && filterExts.length > 0 && !e.isDirectory()) {
            if (!filterExts.includes(ext)) continue;
          }

          if (e.isDirectory()) {
            let entryCount = 0;
            if (depth >= maxDepth) {
              // Count children without recursing further
              try {
                const children = await readdir(join(dir, e.name));
                entryCount = children.length;
              } catch {}
            }
            results.push({ type: "dir", name: e.name, path: relPath, entryCount });
            if (depth < maxDepth) {
              await walk(join(dir, e.name), depth + 1);
            }
          } else {
            let size: number | undefined;
            if (depth === 1) {
              try { size = (await stat(join(dir, e.name))).size; } catch {}
            }
            results.push({ type: "file", name: e.name, path: relPath, size });
          }
        }
      }

      await walk(base, 1);

      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: `No entries found at "${params.path || "."}" matching the given filters.` }] };
      }

      return {
        content: [{ type: "text" as const, text: `Found ${results.length} entr${results.length === 1 ? "y" : "ies"} at "${params.path || "."}":\n\n${results.map((r) => {
          let line = `  ${r.type === "dir" ? "📁" : "📄"} ${r.path}`;
          if (r.size !== undefined) line += ` (${r.size} B)`;
          if (r.entryCount !== undefined) line += ` (${r.entryCount} items)`;
          return line;
        }).join("\n")}` }],
      };
    },
  });

  pi.registerTool({
    name: "wiki_timestamp",
    label: "Wiki Timestamp",
    description: "Return the current system time (ISO 8601 UTC) for wiki operations. Use this instead of guessing or hardcoding timestamps.",
    promptSnippet: "Get current system time",
    promptGuidelines: [
      "Call wiki_timestamp whenever you need to timestamp wiki output. Never guess the time.",
    ],
    parameters: Type.Object({}),
    async execute(_id, _params, _signal) {
      const now = new Date().toISOString();
      return { content: [{ type: "text" as const, text: now }] };
    },
  });

  pi.registerTool({
    name: "wiki_changelog",
    label: "Wiki Changelog",
    description:
      "Record a changelog entry for wiki file changes made in this session. "
      + "Entries have user-facing fields (category, user, what, why, next) for skimmable benefit-first summaries, "
      + "plus developer-facing fields (summary, files, action) for technical detail. "
      + "If files is omitted, the tool scans the session context for changed wiki files. "
      + "Entries are stored in docs/wiki/changelog/YYYY-MM.jsonl.",
    promptSnippet:
      "Record a changelog entry for wiki file changes",
    promptGuidelines: [
      "Call wiki_changelog after finishing wiki updates to record what changed and why.",
      "Use user-facing fields (category, user, what, why, next) for changes the team should see — write user in plain language, lead with the benefit.",
      "Use summary for developer-oriented detail. At least one of user or summary must be provided.",
    ],
    parameters: Type.Object({
      category: Type.Optional(StringEnum(["New", "Improved", "Fixed", "Deprecated", "Removed"], { description: "User-facing category for the What's New template" })),
      user: Type.Optional(Type.String({ description: "User-facing benefit statement — one line a team member scans in 2 seconds (e.g. 'Search is now faster and easier to filter by tag')" })),
      what: Type.Optional(Type.String({ description: "What changed in plain language" })),
      why: Type.Optional(Type.String({ description: "Why this change matters to the team" })),
      next: Type.Optional(Type.String({ description: "CTA — what to do next (e.g. 'See docs/wiki/learnings/foo' or 'Try wiki_search(\\'auth\\')')" })),
      summary: Type.Optional(Type.String({ description: "Developer-facing detail — what changed and why (e.g. 'Documented PieTask port discovery in learnings, updated overview')" })),
      files: Type.Optional(Type.Array(Type.String(), { description: "List of wiki file paths that were changed (auto-detected from context if omitted)" })),
      action: Type.Optional(StringEnum(["sync", "edit", "create", "refactor"], { default: "edit" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      const refuse = worktreeWriteRefusal(); if (refuse) return refuse;
      const cwd = ctx.cwd;

      // Auto-detect changed wiki files from session context if not provided
      let files = params.files;
      if (!files || files.length === 0) {
        files = [];
        try {
          const seen = new Set<string>();
          for (const entry of ctx.sessionManager.getBranch()) {
            if (entry.type !== "message") continue;

            // Check assistant text for file references
            if (entry.message?.role === "assistant") {
              const parts = entry.message.content;
              if (Array.isArray(parts)) {
                for (const part of parts) {
                  if (part?.type === "text" && typeof part.text === "string") {
                    const wikiFiles = part.text.match(/docs\/wiki\/[^\s)"]+/g);
                    if (wikiFiles) {
                      wikiFiles.forEach((f: string) => {
                        const clean = f.replace(/\.md\)?/, ".md").replace(/[)"']$/, "");
                        if (!seen.has(clean)) { seen.add(clean); files!.push(clean); }
                      });
                    }
                  }
                }
              }
            }

            // Check tool call parameters for paths
            if (entry.message?.tool_calls) {
              for (const tc of entry.message.tool_calls) {
                if (tc.function?.name?.startsWith("wiki_")) {
                  try {
                    const args = JSON.parse(tc.function.arguments);
                    const path = args.title || args.concept;
                    if (path && !seen.has(path)) { seen.add(path); files!.push(path); }
                  } catch {}
                }
              }
            }

            // Check tool results for file paths
            if (entry.message?.role === "tool" && entry.message.content) {
              const parts = entry.message.content;
              if (Array.isArray(parts)) {
                for (const part of parts) {
                  if (part?.type === "text" && typeof part.text === "string") {
                    const wikiFiles = part.text.match(/docs\/wiki\/[^\s)"]+/g);
                    if (wikiFiles) {
                      wikiFiles.forEach((f: string) => {
                        const clean = f.replace(/\.md\)?/, ".md").replace(/[)"']$/, "");
                        if (!seen.has(clean)) { seen.add(clean); files!.push(clean); }
                      });
                    }
                  }
                }
              }
            }
          }
        } catch {}
      }

      const now = new Date();
      const ym = now.toISOString().slice(0, 7);
      const changelogDir = join(wikiDir(cwd), "changelog");
      await mkdir(changelogDir, { recursive: true });

      // ponytail: build entry with only the fields that were provided
      const entry: Record<string, unknown> = {
        ts: now.toISOString(),
        action: params.action || "edit",
        files,
      };
      if (params.category) entry.category = params.category;
      if (params.user) entry.user = params.user;
      if (params.what) entry.what = params.what;
      if (params.why) entry.why = params.why;
      if (params.next) entry.next = params.next;
      if (params.summary) entry.summary = params.summary;

      const logPath = join(changelogDir, `${ym}.jsonl`);
      await writeFile(logPath,
        (existsSync(logPath) ? await readFile(logPath, "utf8") : "")
        + JSON.stringify(entry) + "\n",
        "utf8");

      return {
        content: [{
          type: "text" as const,
          text: `Changelog entry recorded (${ym}.jsonl): ${params.user || params.summary || "wiki update"}`,
        }],
      };
    },
  });

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  // Cleanup wiki server + cancel any pending debounced recap on shutdown
  pi.on("session_shutdown", async () => {
    clearRecapTimer();
    shutdownAllWikiServers();
  });

  pi.registerCommand("wiki", {
    description: "Open the wiki viewer in the browser via local HTTP server",
    handler: async (_args, ctx) => {
      // ctx is used after awaits (server start, file writes) — guard stale ctx.
      ctx = staleSafeCtx(ctx);
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify("Project not trusted", "error");
        return;
      }
      const wd = wikiDir(ctx.cwd);
      if (!existsSync(wd)) {
        ctx.ui.notify("No docs/wiki/ found in this project. Run /wiki:init first.", "warning");
        return;
      }
      try {
        ctx.ui.setStatus("wiki", "wiki viewer...");

        ctx.ui.setStatus("wiki", "starting wiki server...");
        const url = await serveWikiViewer(ctx.cwd);

        // Also persist wiki-viewer.html + wiki.js to disk for offline use
        try {
          const wd = wikiDir(ctx.cwd);
          const [html, js] = await Promise.all([
            generateWikiViewerHtml(ctx.cwd),
            generateWikiDataJs(ctx.cwd),
          ]);
          await Promise.all([
            writeFile(join(wd, "wiki-viewer.html"), html, "utf8"),
            writeFile(join(wd, "wiki.js"), js, "utf8"),
          ]);
        } catch {
          // non-critical
        }

        ctx.ui.setStatus("wiki", undefined);
        ctx.ui.notify(`Wiki viewer: ${url}`, "info");
      } catch (e) {
        ctx.ui.setStatus("wiki", undefined);
        ctx.ui.notify(`Failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });

  pi.registerCommand("wiki:update", {
    description: "Run the wiki-curator agent now to sync docs/wiki/ with changed files (same as the staleness prompt, on demand)",
    handler: async (_args, ctx) => {
      // ctx is used after awaits (scan, subagent run) — guard stale ctx.
      ctx = staleSafeCtx(ctx);
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify("Project not trusted", "error");
        return;
      }
      if (IS_WORKTREE) {
        ctx.ui.notify("docs/wiki/ is read-only in a worktree — run /wiki:update from the main checkout.", "warning");
        return;
      }
      if (!existsSync(wikiDir(ctx.cwd))) {
        ctx.ui.notify("No docs/wiki/ found in this project. Run /wiki:init first.", "warning");
        return;
      }
      try {
        ctx.ui.setStatus(FOOTER_KEY, "wiki: checking...");
        const update = await buildUpdateTask(ctx.cwd);
        if (!update) {
          ctx.ui.setStatus(FOOTER_KEY, `wiki: ${ctx.ui.theme.fg("success", "●")} synced`);
          ctx.ui.notify("Wiki is already synced — no changed files, no OKF errors.", "info");
          return;
        }
        ctx.ui.setStatus(FOOTER_KEY, `wiki: running ${CURATOR_AGENT} (${update.changed.length} files)...`);
        // Fire-and-forget spawn — same runner the debounced recap uses; notify on done.
        spawnWikiAgent(
          ctx.cwd, CURATOR_AGENT, update.task, parentModelRef(ctx),
          (msg, type) => {
            try { ctx.ui.setStatus(FOOTER_KEY, undefined); } catch { /* stale */ }
            staleSafeCtx(ctx).ui.notify(msg, type);
          },
        );
      } catch (e) {
        ctx.ui.setStatus(FOOTER_KEY, undefined);
        ctx.ui.notify(`/wiki:update failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });

  pi.registerCommand("wiki:init", {
    description: "Scaffold a stub OKF wiki bundle at docs/wiki/ (+ .wiki_ignore)",
    handler: async (_args, ctx) => {
      // ctx is used after awaits (confirm dialog, initBundle) — guard stale ctx.
      ctx = staleSafeCtx(ctx);
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify("Project not trusted", "error");
        return;
      }
      if (IS_WORKTREE) {
        ctx.ui.notify("docs/wiki/ is read-only in a worktree — run /wiki:init from the main checkout.", "warning");
        return;
      }
      try {
        if (existsSync(wikiDir(ctx.cwd))) {
          const ok = ctx.hasUI ? await ctx.ui.confirm("Wiki exists", "docs/wiki/ already exists. Re-init (will not overwrite existing concept files)?") : false;
          if (!ok) return;
        }
        await initBundle(ctx.cwd);
        // Explicit init overrides an earlier decline.
        saveOmitted(loadOmitted().filter((d) => d !== ctx.cwd));
        ctx.ui.notify("docs/wiki/ scaffolded.", "info");
      } catch (e) {
        ctx.ui.notify(`wiki:init failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });
}

// ---------------------------------------------------------------------------
// (cwd is now passed via each tool's ctx; no module-level slot needed.)

