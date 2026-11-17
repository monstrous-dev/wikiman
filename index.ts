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
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
  ".wiki-debug.log",
  // Lock files — churn on every install, meaningless for the wiki
  "*.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
];
const LAST_UPDATED = "last_updated.md";
// Folders where the user declined wiki init (asked once, never re-asked).
// ponytail: flat array keyed by absolute path; per-project state file if this ever needs metadata.
const OMITTED_FILE = join(homedir(), ".pi", "agent", ".wiki-omitted.json");
// Folders where the user DISCONNECTED the wiki: extension machinery off
// (injection, staleness, recap, /wiki:update), docs/wiki/ kept untouched.
const DISCONNECTED_FILE = join(homedir(), ".pi", "agent", ".wiki-disconnected.json");
const SENTINEL = "<!-- wiki-context:v1 -->";
const FOOTER_KEY = "wiki";
const RESOURCE_TRUNCATE = 200;
// Linked-worktree mode: reads work, writes refuse (wiki lives in main checkout).
let IS_WORKTREE = false;
const MEMORY_FILE = "memory.md";
const MEMORY_START = "<!-- wiki-memory:start -->";
const MEMORY_END = "<!-- wiki-memory:end -->";
// F2: the bundle schema this extension ships. Bundles stamped lower (or
// missing the stamp — legacy 0.1) are migrated additively at session start.
const BUNDLE_VERSION = "0.2";
// Folders where the user DECLINED a bundle migration — never re-asked until a
// newer version than the declined one ships. cwd → declined version string.
const MIGRATION_DECLINED_FILE = join(homedir(), ".pi", "agent", ".wiki-migration-declined.json");

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

// --- Disconnected-folders registry (/wiki:disconnect ↔ /wiki:reconnect) ---
// Same shape as the omitted registry: flat array of absolute cwds in agent
// home, best-effort persistence. Disconnect is user-explicit (never set by
// prompts), and unlike omission it does NOT delete or hide docs/wiki/ — the
// bundle stays on disk, tools stay callable, the viewer stays openable; only
// the proactive machinery (injection, staleness asks, recap, curator) pauses.

function loadDisconnected(): string[] {
  try {
    const raw = JSON.parse(readFileSync(DISCONNECTED_FILE, "utf8"));
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return []; // missing or corrupt → treat as connected
  }
}

function saveDisconnected(list: string[]): void {
  try {
    writeFileSync(DISCONNECTED_FILE, JSON.stringify(list, null, 2) + "\n", "utf8");
  } catch {
    // best-effort: worst case the wiki reconnects next session
  }
}

function isDisconnected(cwd: string): boolean {
  return loadDisconnected().includes(cwd);
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
  baseDir?: string,
): Promise<{ path: string; text: string } | null> {
  const stripped = concept.replace(/^@/, "").replace(/\.md$/, "");
  const base = baseDir ?? wikiDir(cwd);
  const candidates = [
    join(base, `${stripped}.md`),
    join(base, stripped), // already .md or index
    join(base, stripped, "index.md"),
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
  const dupe = await findExistingNote(cwd, dir, title);
  if (dupe) {
    return {
      content: [{ type: "text", text: `Already recorded — ${dupe.id} ("${dupe.title}"). Nothing written (dedupe-at-write). Reference it as [[${dupe.title}]] or wiki_get("${dupe.id}") to review.` }],
    };
  }
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

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** R6 dedupe-at-write: same normalized title in the same folder → already
 *  exists; return its id instead of writing a near-duplicate. */
async function findExistingNote(cwd: string, dir: string, title: string): Promise<{ id: string; title: string } | null> {
  if (!existsSync(dir)) return null;
  const target = normalizeTitle(title);
  if (!target) return null;
  const root = wikiDir(cwd);
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".md") || f === "index.md") continue;
    try {
      const { yaml } = parseFrontmatter(await readFile(join(dir, f), "utf8"));
      const t = String(yaml.title ?? "");
      if (t && normalizeTitle(t) === target) {
        return { id: relative(root, join(dir, f)).replace(/\\/g, "/").replace(/\.md$/, ""), title: t };
      }
    } catch {
      continue;
    }
  }
  return null;
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
  const dupe = await findExistingNote(cwd, dir, title);
  if (dupe) {
    return {
      content: [{ type: "text", text: `Already recorded — ${dupe.id} ("${dupe.title}"). Nothing written (dedupe-at-write). Reference it as [[${dupe.title}]] or wiki_get("${dupe.id}") to review.` }],
    };
  }
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
    if (ent.isDirectory()) {
      // journal/ is episodic (R2) — not a semantic concept: keep it out of the
      // validator, nav map, memory digest, and search, or agents get nagged
      // into "repairing" its frontmatter (observed repair loop in e2e).
      if (ent.name === "journal") continue;
      await walkMd(p, acc);
    } else if (ent.name.endsWith(".md")) acc.push(p);
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
    // W6: stale concept — untouched 90+ days. Warn only, never auto-delete (R6).
    try {
      const mtimeMs = (await stat(f)).mtimeMs;
      if (Date.now() - mtimeMs > 90 * 86_400_000) {
        warnings.push(`W6: ${rel} stale — untouched for 90+ days; refresh or supersede it`);
      }
    } catch {
      /* stat failed — skip staleness check */
    }
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
// End-of-turn recap (agent_end) — in-process completion (R1, self-contained)
// ---------------------------------------------------------------------------
// At the FINAL agent_end of a user turn we make ONE model completion call that
// mines the turn for decisions / rules / learnings / preferences / pages and
// returns them as a JSON array. Deterministic code normalizes and writes the
// notes through the same noteInto/notePage funnel the wiki_note_* tools use —
// the prompt asks for the shape, the code guarantees it (never trust
// LLM-authored paths or frontmatter). No agentman, no subagent: works on a
// clean install of just this package. Because agent_end fires once per agent
// RUN and a prompt can chain runs (prompt -> continue for steer/retry/
// compaction/queued msgs), the call is DEBOUNCED: scheduled on agent_end,
// cancelled by the next agent_start / compaction_start — only the last
// agent_end of the prompt fires. Missing model/auth degrades silently; the
// manual wiki_note_* tools are never blocked.

// Set before any hidden/system dispatch (init auto-doc, staleness delegation
// steer) so that turn's agent_end doesn't spuriously spawn a recap. Checked and
// cleared at the top of the agent_end handler. The recap subagent itself runs
// in a child process — its agent_end fires there, not here, so no feedback loop.
let suppressRecap = false;
// Set when a staleness sync task was queued to ride the user's next prompt
// (no-runner fallback). wiki_mark_synced clears it + flips the footer to
// synced — that tool call is the completion signal of the queued task.
let stalenessQueued = false;

// Debounce timer for the recap spawn. agent_end fires once per agent RUN, and a
// single user prompt can chain multiple runs (prompt -> continue for
// steer/retry/compaction/queued msgs). To avoid spawning a recap per run, we
// schedule on agent_end and cancel on agent_start / compaction_start — only the
// FINAL agent_end (no continuation follows) actually fires the recap.
let recapTimer: ReturnType<typeof setTimeout> | undefined;
const RECAP_DEBOUNCE_MS = 1200;

// ponytail: cap the transcript handed to the recap completion — first ~8KB
// carries the substance, keeps the call cheap.
const RECAP_MAX_CHARS = 8000;
const RECAP_TIMEOUT_MS = 45_000;
const RECAP_MAX_ATTEMPTS = 2;

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
    // R6: surface wiki-note evidence so the recap does not re-record what the
    // in-turn agent already captured (paraphrase duplicates observed in e2e).
    if (role === "toolResult") {
      const toolName = (msg as { toolName?: string })?.toolName ?? "";
      if (toolName.startsWith("wiki_note_")) {
        const t = messageText(msg);
        out.push(`TOOL ${toolName}: ${t.slice(0, 200)}`);
      }
      continue;
    }
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

// --- In-process recap (R1): prompt asks for the shape, code guarantees it ---

interface RecapEnv {
  cwd: string;
  model: unknown;
  modelRegistry: any;
  notify: (msg: string, type?: "info" | "warning" | "error") => void;
}

const RECAP_PROMPT = (turnText: string): string =>
  `You are this project's wiki-recap: decide what one finished coding turn taught us that is worth persisting to docs/wiki/, and produce a session journal entry.

Record ONLY (be selective — routine work warrants an EMPTY notes array):
- "decision" — MAJOR choice or direction shift: architecture, library selection, approach pivot, deprecation.
- "rule" — reusable heuristic or "always do X" convention; name when it applies and the evidence.
- "learning" — non-obvious fact, gotcha, or behavior discovered about this codebase.
- "preference" — a stated user style/tool/convention preference.
- "concept", "entity", "artifact" — a new project page: Concept = abstract idea, Entity = concrete named thing (endpoint/service/model), Artifact = deliverable.

Return ONLY one JSON object — no prose, no markdown fences:
{"notes":[{"type":"learning","title":"Short title","body":"markdown body, 1-3 short paragraphs","tags":["optional"]}],"journal":{"attempted":"what this turn set out to do (max 200 chars)","landed":"what actually changed or was learned (max 200 chars)","open":"what is unfinished or the next step, or empty"}}

Your notes must be ADDITIONS the turn missed. If the transcript shows TOOL wiki_note_* calls that already recorded a fact, do NOT re-record it or a paraphrase of it — duplicating existing concepts is the worst thing you can do. The journal is still required.

--- TURN ---
${turnText}
--- END TURN ---`;

const RECAP_TYPE_MAP: Record<
  string,
  | { kind: "note"; folder: "learnings" | "rules" | "decisions" | "preferences"; type: string }
  | { kind: "page"; pageType: "Concept" | "Entity" | "Artifact" }
> = {
  learning: { kind: "note", folder: "learnings", type: "Learning" },
  rule: { kind: "note", folder: "rules", type: "Rule" },
  decision: { kind: "note", folder: "decisions", type: "Decision" },
  preference: { kind: "note", folder: "preferences", type: "Preference" },
  concept: { kind: "page", pageType: "Concept" },
  entity: { kind: "page", pageType: "Entity" },
  artifact: { kind: "page", pageType: "Artifact" },
};

interface RecapNote { type: string; title: string; body: string; tags?: string[] }
interface JournalEntry { attempted?: string; landed?: string; open?: string }
interface RecapReply { notes: RecapNote[]; journal?: JournalEntry }

/** Parse the model's reply into validated notes + journal; null = unparseable.
 *  Accepts both the current object shape and a bare notes array (older
 *  contract). Unknown types and empty fields are dropped. */
function parseRecapReply(text: string): RecapReply | null {
  const cleaned = text.replace(/```(?:json)?/gi, ""); // fences tolerated even though the prompt forbids them
  const start = cleaned.indexOf("{") >= 0 ? cleaned.indexOf("{") : cleaned.indexOf("[");
  const lastObj = cleaned.lastIndexOf("}");
  const lastArr = cleaned.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  let rawNotes: unknown = parsed;
  let journal: JournalEntry | undefined;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    rawNotes = o.notes ?? [];
    if (o.journal && typeof o.journal === "object") {
      const j = o.journal as Record<string, unknown>;
      journal = {
        attempted: typeof j.attempted === "string" ? j.attempted : undefined,
        landed: typeof j.landed === "string" ? j.landed : undefined,
        open: typeof j.open === "string" ? j.open : undefined,
      };
    }
  }
  if (!Array.isArray(rawNotes)) return null;
  const notes: RecapNote[] = [];
  for (const raw of rawNotes) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const type = typeof r.type === "string" ? r.type.trim().toLowerCase() : "";
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const body = typeof r.body === "string" ? r.body.trim() : "";
    if (!RECAP_TYPE_MAP[type] || !title || !body) continue; // unknown type / empty fields → skip
    const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : undefined;
    notes.push({ type, title, body, tags: tags && tags.length ? tags : undefined });
  }
  return { notes, journal };
}

/** Extract text from a completion result (hamster pattern). */
function completionText(result: unknown): string {
  const msg = result as { content?: Array<{ type?: string; text?: string }> };
  if (!msg?.content || !Array.isArray(msg.content)) return "";
  return msg.content.filter((c) => c?.type === "text").map((c) => c?.text ?? "").join("\n").trim();
}

async function completeOnce(env: RecapEnv, prompt: string, timeoutMs = RECAP_TIMEOUT_MS): Promise<string> {
  const result = await env.modelRegistry.complete(
    env.model,
    { messages: [{ role: "user", content: [{ type: "text", text: prompt }] }] } as Parameters<typeof env.modelRegistry.complete>[1],
    { signal: AbortSignal.timeout(timeoutMs), sessionId: randomUUID() },
  );
  const asMsg = result as { stopReason?: string; errorMessage?: string };
  if (asMsg?.stopReason === "error" || asMsg?.stopReason === "aborted") {
    throw new Error(asMsg?.errorMessage || `recap request ${asMsg?.stopReason}`);
  }
  return completionText(result);
}

/** Append the session journal entry (R2). Deterministic format, episodic:
 *  docs/wiki/journal/YYYY-MM.md under a ## YYYY-MM-DD heading. */
async function appendJournal(cwd: string, j: JournalEntry): Promise<void> {
  const dir = join(wikiDir(cwd), "journal");
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const month = now.slice(0, 7);
  const day = now.slice(0, 10);
  const cap = (s?: string) => (s ?? "").trim().slice(0, 220).replace(/\r?\n/g, " ");
  const lines: string[] = [];
  if (cap(j.attempted)) lines.push(`- attempted: ${cap(j.attempted)}`);
  if (cap(j.landed)) lines.push(`- landed: ${cap(j.landed)}`);
  if (cap(j.open)) lines.push(`- open: ${cap(j.open)}`);
  if (!lines.length) return;
  const p = join(dir, `${month}.md`);
  let text = existsSync(p) ? await readFile(p, "utf8") : `# Session journal — ${month}\n`;
  text = text.includes(`## ${day}`)
    ? text.trimEnd() + "\n" + lines.join("\n") + "\n"
    : text.trimEnd() + `\n\n## ${day}\n` + lines.join("\n") + "\n";
  await writeFile(p, text, "utf8");
}

/** Latest journal block for the resume-card injection (hard-capped). */
async function latestJournal(cwd: string): Promise<string> {
  const dir = join(wikiDir(cwd), "journal");
  if (!existsSync(dir)) return "";
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    try {
      const text = await readFile(join(dir, files[i]), "utf8");
      const blocks = text.split(/^## /m).filter((b) => b.trim());
      if (blocks.length) return capChars(("## " + blocks[blocks.length - 1]).split("\n").slice(0, 12).join("\n"), 1200);
    } catch {
      /* try an older file */
    }
  }
  return "";
}

/** Fire-and-forget inline recap. Never throws — every failure is notified or silent. */
async function runInlineRecap(env: RecapEnv, turnText: string): Promise<void> {
  const snippet = turnText.length > RECAP_MAX_CHARS ? turnText.slice(0, RECAP_MAX_CHARS) + "\n[...truncated]" : turnText;
  let reply: RecapReply | null = null;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RECAP_MAX_ATTEMPTS && reply === null; attempt++) {
    const retry = attempt > 1
      ? "\n\nIMPORTANT: your previous reply was not parseable. Return ONLY the raw JSON object — no prose, no fences."
      : "";
    try {
      reply = parseRecapReply(await completeOnce(env, RECAP_PROMPT(snippet) + retry));
    } catch (e) {
      lastErr = e;
    }
  }
  if (reply === null) {
    if (lastErr) env.notify(`wiki recap failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, "warning");
    return;
  }
  const notes = reply.notes;
  if (notes.length === 0 && !reply.journal) {
    env.notify("wiki recap: nothing to record.", "info");
    return;
  }
  const counts: Record<string, number> = {};
  for (const n of notes) {
    const map = RECAP_TYPE_MAP[n.type];
    if (!map) continue;
    try {
      if (map.kind === "note") await noteInto(env.cwd, map.folder, map.type, n.title, n.body, n.tags);
      else await notePage(env.cwd, map.pageType, n.title, n.body, n.tags);
      counts[n.type] = (counts[n.type] ?? 0) + 1;
    } catch {
      // one bad note must not kill the rest
    }
  }
  let journalBit = "";
  if (reply.journal) {
    try {
      await appendJournal(env.cwd, reply.journal);
      journalBit = " + journal";
    } catch { /* journal is best-effort */ }
  }
  const summary = Object.entries(counts).map(([t, c]) => `${c} ${t}${c > 1 ? "s" : ""}`).join(", ");
  env.notify(summary || journalBit ? `wiki recap: recorded ${summary || "nothing"}${journalBit}.` : "wiki recap: nothing to record.", "info");
}

/** Task prompt for when the curator subagent is unavailable: the session LLM
 *  performs the wiki sync itself with its own tools. */
function curatorFallbackPrompt(task: string): string {
  return `Wiki update (curator subagent unavailable — perform it yourself in this turn; you have the wiki_* tools plus read/edit/bash):

--- BEGIN TASK ---
${task}
--- END TASK ---

House rules: dedupe first (wiki_search before writing), edit existing concepts in place instead of duplicating, never invent frontmatter types, then call wiki_mark_synced(). Do NOT narrate this task — just do it and confirm in one line.`;
}

/**
 * Debounced wrapper around runInlineRecap: clears any pending run and re-arms it.
 * A subsequent agent_start / compaction_start (i.e. a continuation) cancels
 * via clearRecapTimer(), so only the last agent_end of a prompt runs.
 * Timer-scheduled promises outlive their caller — the .catch below is not
 * optional (an unhandled rejection here has killed a session before).
 */
function scheduleRecap(env: RecapEnv, turnText: string): void {
  clearRecapTimer();
  recapTimer = setTimeout(() => {
    recapTimer = undefined;
    runInlineRecap(env, turnText).catch((e) => {
      try {
        env.notify(`wiki recap failed: ${e instanceof Error ? e.message : String(e)}`, "warning");
      } catch {
        /* stale ctx */
      }
    });
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

/**
 * Fire-and-forget spawn of the wiki-curator subagent via the
 * intelligent-delegation runner (/wiki:update only — the recap is in-process).
 * When the runner or the agent prompt is unavailable, calls fallbackSteer so
 * the session LLM performs the update itself. Notifies on completion; never
 * throws to caller.
 */
function spawnWikiAgent(
  cwd: string,
  agentName: string,
  task: string,
  parentModel: string | undefined,
  notify?: (msg: string, type?: "info" | "warning" | "error") => void,
  fallbackSteer?: (task: string) => void,
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
      notify?.(`wiki ${agentName} unavailable (intelligent-delegation extension not installed) — falling back to an in-session update.`, "warning");
      fallbackSteer?.(task);
      return;
    }
    const agents = agentsMod.discoverAgents(cwd, "both").agents;
    if (!agents.some((a: any) => a.name === agentName)) {
      notify?.(`wiki ${agentName} prompt not found in ~/.pi/agent/agents — falling back to an in-session update.`, "warning");
      fallbackSteer?.(task);
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

/** Background-sync probe: is the intelligent-delegation runner installed AND
 *  the wiki-curator agent prompt present? Used to decide between spawning the
 *  curator as a true background child vs piggybacking the next user prompt. */
async function runnerCanSpawn(cwd: string): Promise<boolean> {
  try {
    const [, agentsMod] = await Promise.all([
      import("../intelligent-delegation/runner.ts"),
      import("../intelligent-delegation/agents.ts"),
    ]);
    return agentsMod.discoverAgents(cwd, "both").agents.some((a: any) => a.name === CURATOR_AGENT);
  } catch {
    return false;
  }
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

  const task = update.task;

  // RPC mode (e.g. a delegated wiki-curator sub-agent): never spawn background
  // children from here — skip entirely (footer status already set above).
  if (ctx.mode === "rpc") return;

  if (!ctx.hasUI) {
    // Headless: ride the next turn as a hidden queued message — no run is
    // triggered; the task processes only if a continuation happens.
    getApi().pi.sendMessage(
      { customType: "wiki-staleness", content: task, display: false },
      { triggerTurn: false, deliverAs: "nextTurn" },
    );
    return;
  }

  // TUI — background-first: wiki updates must never interrupt the user.
  // 1) Subagent runner available → spawn the curator DIRECTLY: a background
  //    child process, no dialog, no session turn. The user keeps working;
  //    the completion notify lands on its own.
  if (await runnerCanSpawn(cwd)) {
    ctx.ui.setStatus(FOOTER_KEY, `wiki: ${dot("warning")} updating (background)`);
    spawnWikiAgent(
      ctx.cwd, CURATOR_AGENT, task, parentModelRef(ctx),
      (msg, type) => {
        try {
          staleSafeCtx(ctx).ui.notify(msg, type);
          // Approximate post-sync footer; the next session_start corrects it.
          if (type === "info") ctx.ui.setStatus(FOOTER_KEY, `wiki: ${dot("success")} synced (background)`);
          else ctx.ui.setStatus(FOOTER_KEY, staleMsg);
        } catch {
          /* stale ctx */
        }
      },
    );
    return;
  }

  // 2) No runner → piggyback the sync on the user's NEXT prompt as a hidden
  //    queued message (display:false, no run triggered): zero interruptions,
  //    the sync rides along silently when they next interact. The 1h cooldown
  //    keeps queued tasks from stacking on every session start.
  if (askedRecently(cwd)) return;
  markAsked(cwd);
  stalenessQueued = true;
  ctx.ui.setStatus(FOOTER_KEY, `wiki: ${dot("warning")} stale — sync queued (rides your next prompt)`);
  getApi().pi.sendMessage(
    { customType: "wiki-staleness", content: task, display: false },
    { triggerTurn: false, deliverAs: "nextTurn" },
  );
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

// R3: injection budget constants — enforced in buildInjection, surfaced later
// by /wiki:stats. Deterministic: identical wiki state → identical injection.
const INJECTION_MAX_CHARS = 12_000;
const NAV_MAX_ENTRIES = 40;
const OVERVIEW_MAX_CHARS = 3_500;
const MEMORY_MAX_CHARS = 3_000;

const TYPE_WEIGHT: Record<string, number> = {
  decisions: 5, rules: 4, learnings: 3, architecture: 2.5,
  "pages/concepts": 2.5, "pages/entities": 2.5, "pages/artifacts": 2,
  preferences: 2, glossary: 1, root: 1,
};

// R8: global memory tier — a strict slice of the agent-home wiki injected
// below the project wiki in every project session. Advisory titles only;
// bodies stay lazy-loadable via wiki_get("global/<id>").
const AGENT_WIKI = join(homedir(), ".pi", "agent", "docs", "wiki");
const GLOBAL_TIER_MAX_CHARS = 1_500;

async function globalTierSlice(): Promise<string> {
  const entries: { title: string; desc: string; rel: string; mtime: number }[] = [];
  for (const d of ["rules", "preferences"]) {
    const dir = join(AGENT_WIKI, d);
    if (!existsSync(dir)) continue;
    for (const f of await walkMd(dir)) {
      if (basename(f) === "index.md") continue;
      try {
        const { yaml } = parseFrontmatter(await readFile(f, "utf8"));
        entries.push({
          title: String(yaml.title ?? basename(f, ".md")),
          desc: String(yaml.description ?? ""),
          rel: `${d}/${basename(f, ".md")}`,
          mtime: (await stat(f)).mtimeMs,
        });
      } catch {
        continue;
      }
    }
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries
    .slice(0, 8)
    .map((e) => `- ${e.title}${e.desc ? ` — ${e.desc}` : ""} (wiki_get("global/${e.rel}"))`)
    .join("\n");
}

/** R7 bootstrap import: docs/adr/*.md → Concept starter pages. One page per
 *  ADR, wikilinkable, Source-linked. Deterministic; ask-first is the caller's
 *  job (UI-only — headless sessions are never surprised). */
async function importAdrs(cwd: string): Promise<number> {
  const adrDir = join(cwd, "docs", "adr");
  if (!existsSync(adrDir)) return 0;
  let n = 0;
  for (const f of (await readdir(adrDir)).filter((x) => x.endsWith(".md")).sort()) {
    try {
      const raw = await readFile(join(adrDir, f), "utf8");
      const body = raw.replace(/^---[\s\S]*?---\s*/, "").replace(/^#\s+.*\r?\n/, "").trim();
      const title = (raw.match(/^#\s+(.+)$/m)?.[1] ?? basename(f, ".md")).trim();
      const r = await notePage(cwd, "Concept", title, `${body}\n\nSource: docs/adr/${f} — original decision record.`, ["adr"]);
      if (!String(r.content[0]?.text ?? "").startsWith("Already recorded")) n++;
    } catch {
      continue;
    }
  }
  return n;
}

function capChars(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "\n…(truncated — use wiki_get for the full content)";
}

/** R4: recent files from git (last ~10 commits + working tree). Time-boxed,
 *  bounded, silent on failure (non-repo → empty set → feature off). */
function recentGitFiles(cwd: string, max = 60): Set<string> {
  try {
    const opts = { cwd, stdio: ["ignore", "pipe", "ignore"] as ("ignore" | "pipe")[], timeout: 250 };
    const log = execSync("git log -10 --name-only --pretty=format:", opts).toString();
    const status = execSync("git status --porcelain", opts).toString();
    const files = new Set<string>();
    for (const line of (log + "\n" + status).split(/\r?\n/)) {
      const f = line.trim().replace(/^\s*[AMDR?]+\s+/, "").replace(/^"|"$/g, "");
      if (!f || f.length > 200) continue;
      files.add(f.replace(/\\/g, "/"));
      if (files.size >= max) break;
    }
    return files;
  } catch {
    return new Set();
  }
}

/** R4: concepts whose declared resource: matches the recent-file set. */
async function resourceMatches(
  cwd: string,
  boostPaths: Set<string>,
  limit: number,
): Promise<Array<{ rel: string; title: string; desc: string }>> {
  const root = wikiDir(cwd);
  if (!existsSync(root)) return [];
  const files = await walkMd(root);
  const out: Array<{ rel: string; title: string; desc: string }> = [];
  for (const f of files) {
    const base = basename(f);
    if (RESERVED.has(base)) continue;
    const rel = relative(root, f).replace(/\\/g, "/").replace(/\.md$/, "");
    try {
      const { yaml } = parseFrontmatter(await readFile(f, "utf8"));
      const res = resourcePath(yaml);
      if (!res || !boostPaths.has(res.replace(/\\/g, "/"))) continue;
      out.push({ rel, title: yaml.title ? String(yaml.title) : rel, desc: yaml.description ? String(yaml.description) : "" });
      if (out.length >= limit) break;
    } catch {
      continue;
    }
  }
  return out;
}

/** Ranked navigation slice: type weight × recency (+ boost for concepts whose
 *  resource: matches recent git activity, fed by R4). Deterministic. */
async function rankedNavSlice(
  cwd: string,
  limit: number,
  boostPaths?: Set<string>,
): Promise<{ lines: string[]; total: number; picked: number }> {
  const root = wikiDir(cwd);
  if (!existsSync(root)) return { lines: [], total: 0, picked: 0 };
  const files = await walkMd(root);
  interface Entry { rel: string; group: string; title: string; desc: string; score: number }
  const entries: Entry[] = [];
  const now = Date.now();
  for (const f of files) {
    const base = basename(f);
    if (RESERVED.has(base)) continue;
    const rel = relative(root, f).replace(/\\/g, "/").replace(/\.md$/, "");
    const text = await readFile(f, "utf8");
    const { yaml } = parseFrontmatter(text);
    const slash = rel.indexOf("/");
    const group = slash >= 0 ? rel.slice(0, slash) : "root";
    try {
      const st = await stat(f);
      const ageDays = (now - st.mtimeMs) / 86_400_000;
      var ageBoost = ageDays < 7 ? 2 : ageDays < 30 ? 1 : 0;
    } catch {
      var ageBoost = 0;
    }
    let score = (TYPE_WEIGHT[group] ?? 1) + ageBoost;
    const res = resourcePath(yaml);
    if (boostPaths && res && boostPaths.has(res.replace(/\\/g, "/"))) score += 3;
    entries.push({ rel, group, title: yaml.title ? String(yaml.title) : rel, desc: yaml.description ? String(yaml.description) : "", score });
  }
  entries.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  const total = entries.length;
  const picked = entries.slice(0, limit);
  const lines: string[] = [];
  let lastGroup = "";
  for (const e of picked) {
    if (e.group !== lastGroup) {
      lines.push(`**${e.group === "root" ? "Core" : e.group}**`);
      lastGroup = e.group;
    }
    lines.push(`- [${e.title}](${e.rel}.md)${e.desc ? ` — ${e.desc}` : ""}`);
  }
  if (total > picked.length) lines.push(`- … ${total - picked.length} more concepts — wiki_search("keyword") finds them`);
  return { lines, total, picked: picked.length };
}

async function buildInjection(cwd: string, boostPaths?: Set<string>): Promise<string | null> {
  const indexP = join(wikiDir(cwd), "index.md");
  const overviewP = join(wikiDir(cwd), "overview.md");
  if (!existsSync(indexP)) return null;
  const overview = existsSync(overviewP) ? await readFile(overviewP, "utf8") : "(no overview.md)";
  const memoryP = join(wikiDir(cwd), MEMORY_FILE);
  const memory = existsSync(memoryP) ? await readFile(memoryP, "utf8") : "";
  // R8: global tier below the project wiki. Cycle guard: when the session cwd
  // IS the agent home, its wiki is already THE project wiki — never double-inject.
  let globalSection = "";
  if (resolve(wikiDir(cwd)).toLowerCase() !== resolve(AGENT_WIKI).toLowerCase()) {
    globalSection = await globalTierSlice();
  }

  // R3: the operating contract — short, imperative, position 0. Baseline
  // evidence: a polite, buried rule did not change tool choice; agents went
  // grep-first. This must read as the protocol, not as an FYI.
  const contract = `# WAYFINDING PROTOCOL — how you locate anything in this project

This project keeps an OKF knowledge wiki at docs/wiki/. It is the authoritative index of the codebase and it is ALREADY IN YOUR CONTEXT below (navigation map + overview). Operating rules:

1. LOCATE: for any "where is X / how does X work / which module does Y" question, find the matching concept in the navigation map FIRST.
2. OPEN: call wiki_get("<concept-id>") on it BEFORE reading any source file — concept bodies name exact paths and the reasoning behind them.
3. GREP IS LAST RESORT: never run grep/find/rg/ls before steps 1-2. Searching the filesystem before consulting the map is a failure, not a shortcut.
4. LAZY-LOAD: read concept bodies one at a time via wiki_get. Never read the whole bundle. Never bulk-list docs/wiki/.
5. MATCH THE TASK, NOT THE RECENCY: scan concept TITLES in the map and open only what this specific task needs — the newest entries are not a reading list.
6. PROGRESSIVE DISCLOSURE: orient from the overview + map; open a concept body only when the task needs that depth; quote sparingly.
7. CLOSE THE LOOP: if the map lacks the area, wiki_discover it, then wiki_note_page what you learned — the next session starts smarter. Call wiki_mark_synced() after wiki edits.

Recording is otherwise automatic (end-of-turn recap) — you only call wiki_note_* when something is urgent or explicit.`;

  const nav = await rankedNavSlice(cwd, NAV_MAX_ENTRIES, boostPaths);
  const navHeader = (n: { total: number; picked: number }) =>
    `## Navigation map — top ${n.picked} of ${n.total} concepts (ranked: decisions/rules first, then recency; wiki_search finds the rest)\n\n`;
  const navSection = nav.lines.length ? navHeader(nav) + nav.lines.join("\n") : "";
  const journal = await latestJournal(cwd);
  const journalSection = journal ? `## Journal — last session (resume where it left off)\n\n${journal}` : "";
  // R4: JIT relevance — concepts tied to files git says we're working near.
  let relevanceBlock = "";
  if (boostPaths && boostPaths.size > 0) {
    const matches = await resourceMatches(cwd, boostPaths, 4);
    if (matches.length) {
      relevanceBlock = `## Relevant to your recent files\n\n` +
        matches.map((m) => `- ${m.title}${m.desc ? ` — ${m.desc}` : ""}\n  wiki_get("${m.rel}")`).join("\n");
    }
  }

  const sections: string[] = [
    contract,
    relevanceBlock,
    journalSection,
    navSection,
    `## overview.md\n\n${capChars(overview, OVERVIEW_MAX_CHARS)}`,
    memory ? `## memory.md — the live contract (recent decisions, rules, conventions)\n\n${capChars(memory, MEMORY_MAX_CHARS)}` : "",
    globalSection ? `## Global memory — agent-home rules & preferences (apply in every project)\n\n${capChars(globalSection, GLOBAL_TIER_MAX_CHARS)}` : "",
    `## Tools (lazy-load the wiki — do NOT read it wholesale)\nwiki_get("<id>") read one concept · wiki_search("kw") find concepts · wiki_related("<id>") follow links · wiki_discover explore filesystem · wiki_note_learning/rule/decision/preference/page record knowledge · wiki_mark_synced after wiki edits · wiki_validate check structure · wiki_changelog user-facing change entry · wiki_timestamp timestamps`,
    SENTINEL,
  ].filter(Boolean) as string[];

  // Budget enforcement — deterministic shrink order: nav slice first (halving),
  // then a hard final cap (which leaves a truncation marker).
  let text = sections.join("\n\n");
  let navLimit = NAV_MAX_ENTRIES;
  while (text.length > INJECTION_MAX_CHARS && navLimit > 8) {
    navLimit = Math.floor(navLimit / 2);
    const tighter = await rankedNavSlice(cwd, navLimit, boostPaths);
    const idx = sections.findIndex((s) => s.startsWith("## Navigation map"));
    sections[idx >= 0 ? idx : 1] = tighter.lines.length ? navHeader(tighter) + tighter.lines.join("\n") : "";
    const cleaned = sections.filter(Boolean);
    text = cleaned.join("\n\n");
  }
  if (text.length > INJECTION_MAX_CHARS) text = capChars(text, INJECTION_MAX_CHARS);
  return text;
}

// ---------------------------------------------------------------------------
// Bundle init scaffold
// ---------------------------------------------------------------------------

async function initBundle(cwd: string): Promise<{ autoDocNeeded: boolean }> {
  const root = wikiDir(cwd);
  // F1 (ensure-semantics): a re-init only ADDS missing scaffold files —
  // authored content (overview, glossary, concepts…) is never overwritten,
  // and last_updated.md is never reset (that would fake a fresh sync).
  const writeIfMissing = async (p: string, content: string, enc: BufferEncoding = "utf8"): Promise<void> => {
    if (existsSync(p)) return;
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content, enc);
  };
  // The auto-doc LLM pass overwrites overview/glossary/file-tree, so it only
  // runs when the bundle is fresh (none of the three pre-existed).
  const hadAuthored = existsSync(join(root, "overview.md"))
    || existsSync(join(root, "glossary.md"))
    || existsSync(join(root, "architecture", "file-tree.md"));
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
    await writeFile(wikiIgnore, DEFAULT_WIKI_IGNORE, "utf8");
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
  await writeIfMissing(
    join(root, "index.md"),
    `${indexFrontmatter()}# Project Knowledge Wiki\n\nAn [OKF](https://github.com/earendil-works/okf) bundle documenting this project.\n\n- [Overview](./overview.md) — What this project contains and its structure\n- [File tree](./architecture/file-tree.md) — Complete project file listing\n- [Glossary](./glossary.md) — Key terms for this project\n${typedLinks ? typedLinks + "\n" : ""}- [Pages](./pages/) — Concepts, entities, and artifacts of this project\n`,
    "utf8",
  );
  await writeIfMissing(join(root, "overview.md"), `${buildFrontmatter({ type: "System Overview", title: "Overview", description: "What this project contains and its structure.", timestamp: now })}\n# Overview\n\n_Describe the project here._\n`, "utf8");
  await writeIfMissing(join(root, "log.md"), `# Update Log\n\n## ${day}\n- **Creation**: Initial OKF bundle scaffolded by /wiki:init.\n`, "utf8");
  await writeIfMissing(join(root, LAST_UPDATED), `# Last wiki sync\n\n${now}\n`, "utf8");
  await writeIfMissing(join(root, "glossary.md"), `${buildFrontmatter({ type: "Glossary", title: "Glossary", description: "Key terms for this project.", timestamp: now })}\n# Glossary\n\n| Term | Definition |\n|------|------------|\n| _term_ | _definition_ |\n`, "utf8");
  await writeIfMissing(join(root, "pages", "index.md"), `# Pages\n\nKnowledge graph: concepts, entities, and artifacts that make up this project.\n\n- [Concepts](./concepts/) — Abstract ideas, definitions, and categories\n- [Entities](./entities/) — Concrete named things, systems, tools, and records\n- [Artifacts](./artifacts/) — Documents, diagrams, code files, and deliverables\n`, "utf8");
  await writeIfMissing(join(root, "pages", "concepts", "index.md"), `# Concepts\n\n_Abstract ideas and definitions will be listed here._\n`, "utf8");
  await writeIfMissing(join(root, "pages", "entities", "index.md"), `# Entities\n\n_Concrete named things will be listed here._\n`, "utf8");
  await writeIfMissing(join(root, "pages", "artifacts", "index.md"), `# Artifacts\n\n_Documents, diagrams, and deliverables will be listed here._\n`, "utf8");

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
  await writeIfMissing(join(root, "pages", "TEMPLATES.md"), templatesContent, "utf8");

  // Generate file tree
  const archDir = join(root, "architecture");
  await mkdir(archDir, { recursive: true });
  const { patterns } = await loadIgnore(cwd);
  // Why: file-tree.md must be born conformant — a bare tree body fails E1
  // (no frontmatter) and W1 (no title/description in the nav map).
  const tree = await generateFileTree(cwd, patterns);
  await writeIfMissing(
    join(archDir, "file-tree.md"),
    `${buildFrontmatter({ type: "Artifact", title: "File tree", description: "Complete project file listing with per-file descriptions.", timestamp: now })}\n${tree}`,
    "utf8",
  );

  // Build the detailed nav map into index.md last so it reflects any LLM-written titles/descriptions.
  await updateIndexNavMap(cwd);
  await regenerateMemory(cwd);
  return { autoDocNeeded: !hadAuthored };
}

interface AutoDocEnv { cwd: string; model: unknown; modelRegistry: any; notify: (msg: string, type?: "info" | "warning" | "error") => void; }

const AUTODOC_TIMEOUT_MS = 60_000;

/** Background auto-doc for a FRESH bundle: scan + one completion call ->
 *  overview/glossary/file-tree descriptions. Deterministic writes; stubs
 *  remain on failure. Throws only to the fire-and-forget wrapper. */
async function generateAutoDocInline(env: AutoDocEnv): Promise<void> {
  const scan = await scanProjectContents(env.cwd);
  const llmPrompt = `I've scanned the project at "${env.cwd}". Based on the summary below, write content for a knowledge wiki (docs/wiki/) that documents this project.\n\nProject profile:\n${JSON.stringify(scan, null, 2)}\n\nAlso fill in the [] description placeholders for each entry in this file tree.\n\nOutput exactly this format:\n\n## Overview\n(2-4 paragraphs describing the project's contents and organization)\n\n## Glossary\n| Term | Definition |\n|------|------------|\n\n## File tree descriptions\npath — description\npath — description`;
  let text = "";
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2 && !text; attempt++) {
    const retry = attempt > 1 ? "\n\nIMPORTANT: your previous reply was not usable. Return the three sections in the exact format shown above." : "";
    try {
      const r = await completeOnce(env, llmPrompt + retry, AUTODOC_TIMEOUT_MS);
      if (r.trim()) text = r;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!text) throw lastErr ?? new Error("auto-doc produced no output");

  const root = wikiDir(env.cwd);
  const archDir = join(root, "architecture");
  const overviewMatch = text.match(/## Overview\n([\s\S]*?)(?=\n## )/);
  const glossaryMatch = text.match(/## Glossary\n([\s\S]*?)(?=\n## |$)/);
  const treeMatch = text.match(/## File tree descriptions\n([\s\S]*?)$/);

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
    const treePath = join(archDir, "file-tree.md");
    if (existsSync(treePath)) {
      const currentTree = await readFile(treePath, "utf8");
      const lines = currentTree.split("\n");
      const descMap = new Map<string, string>();
      for (const line of treeDescriptions.split("\n")) {
        const m = line.match(/^(.+?)\s*[—\-]\s*(.+)$/);
        if (m) descMap.set(m[1].trim(), m[2].trim());
      }
      const newLines = lines.map((l) => {
        const m = l.match(/^(.*)(\[\])$/);
        if (m) {
          const bare = m[1].replace(/[├└─│ ]/g, "").trim();
          const desc = descMap.get(bare) || "";
          return l.replace("[]", desc ? `[${desc}]` : "");
        }
        return l;
      });
      await writeFile(treePath, newLines.join("\n"), "utf8");
    }
  }
  // Derived surfaces over the final content.
  await updateIndexNavMap(env.cwd);
  await regenerateMemory(env.cwd);
}

/** Fire the background auto-doc after a fresh scaffold. Subagent window when
 *  the runner is present, invisible in-process completion otherwise. The user
 *  never waits on init — the scaffold returns instantly and content lands
 *  behind it. Never throws. */
function fireAutoDoc(cwd: string, ctx: any, autoDocNeeded: boolean): void {
  if (!autoDocNeeded) return;
  const notify = (msg: string, type?: "info" | "warning" | "error") => {
    try {
      staleSafeCtx(ctx).ui.notify(msg, type);
    } catch {
      /* stale ctx */
    }
  };
  notify("docs/wiki/ scaffolded — auto-doc (overview/glossary/file-tree) running in the background.", "info");
  (async () => {
    if (await runnerCanSpawn(cwd)) {
      // Subagent window path: the curator bootstraps the bundle off-session.
      notify("auto-doc delegated to a wiki-curator subagent.", "info");
      spawnWikiAgent(
        cwd, CURATOR_AGENT,
        `Bootstrap this fresh OKF wiki bundle at docs/wiki/. Inspect the codebase (README, package manifests, source tree — use read/grep/ls), then write docs/wiki/overview.md (frontmatter type "System Overview", title "Overview", 2-4 paragraphs on contents + organization), docs/wiki/glossary.md (frontmatter type "Glossary", a Term/Definition table of the project's vocabulary), and replace the [] placeholders in docs/wiki/architecture/file-tree.md with per-file descriptions. Then call wiki_mark_synced. Do not touch other files.`,
        parentModelRef(ctx),
        notify,
      );
      return;
    }
    const model = (ctx as any).model;
    const modelRegistry = (ctx as any).modelRegistry;
    if (!model || !modelRegistry || !(modelRegistry.hasConfiguredAuth?.(model) ?? true)) {
      notify("overview/glossary are stubs — no model configured to auto-fill them. Ask the agent to fill them or run /wiki:update later.", "info");
      return;
    }
    await generateAutoDocInline({ cwd, model, modelRegistry, notify });
    notify("wiki auto-doc done — overview, glossary, and file-tree descriptions populated.", "info");
  })().catch((e) => {
    notify(`wiki auto-doc failed: ${e instanceof Error ? e.message : String(e)} — stubs remain.`, "warning");
  });
}

// Ask-first update check: once per 24h, compare installed version against the
// repo's latest git tag. Silent on failure/offline. Notify-only — never
// auto-install (extensions load at session start; mid-session swaps are messy).
const UPDATE_CHECK_FILE = join(homedir(), ".pi", "agent", ".wiki-update-check.json");
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

function cmpSemver(a: string, b: string): number {
  const p = (s: string) => s.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [pa, pb] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

async function checkForUpdate(): Promise<{ current: string; latest: string } | null> {
  try {
    const current = String((JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0");
    let state: { at?: number; latest?: string } = {};
    try {
      state = JSON.parse(readFileSync(UPDATE_CHECK_FILE, "utf8"));
    } catch {
      /* first check */
    }
    if (state.at && Date.now() - state.at < UPDATE_CHECK_INTERVAL) {
      return state.latest && cmpSemver(state.latest, current) > 0 ? { current, latest: state.latest } : null;
    }
    let latest = "";
    try {
      const out = execSync("git ls-remote --tags --refs https://github.com/monstrous-dev/wikiman", {
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"] as ("ignore" | "pipe")[],
      }).toString();
      const tags = out.split(/\r?\n/).map((l) => l.split("refs/tags/")[1] ?? "").filter(Boolean);
      latest = tags.sort(cmpSemver).at(-1) ?? "";
    } catch {
      latest = ""; // offline / not reachable — stay silent
    }
    try {
      writeFileSync(UPDATE_CHECK_FILE, JSON.stringify({ at: Date.now(), latest }), "utf8");
    } catch {
      /* best-effort throttle persistence */
    }
    return latest && cmpSemver(latest, current) > 0 ? { current, latest } : null;
  } catch {
    return null;
  }
}

function indexFrontmatter(): string {
  return `---\nokf_version: "${BUNDLE_VERSION}"\n---\n\n`;
}

// ---------------------------------------------------------------------------
// F2: bundle schema migrations (okf_version-gated, additive-only, idempotent)
// ---------------------------------------------------------------------------
// "Pushing updates" to existing wiki instances: a bundle self-describes its
// schema via okf_version in the root index.md frontmatter. Bundles stamped
// below BUNDLE_VERSION get an additive migration at session start — missing
// surfaces are created, derived surfaces regenerated, existing authored
// content NEVER overwritten. UI sessions ask first; headless/RPC sessions
// (which can't answer dialogs) migrate silently and log. Declines are
// remembered per cwd until a newer version than the declined one ships.

const DEFAULT_WIKI_IGNORE = `# .wiki_ignore — files/dirs excluded from staleness detection
# Add project-specific patterns below. Lines starting with # are comments.

# Wiki self-ignore — wiki edits don't trigger staleness
docs/wiki/

# Common build/dependency/cache directories
node_modules/
dist/
build/
.next/
.cache/
__pycache__/
.DS_Store
`;

function loadMigrationDeclined(): Record<string, string> {
  try {
    const raw = JSON.parse(readFileSync(MIGRATION_DECLINED_FILE, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function saveMigrationDeclined(cwd: string, version: string): void {
  try {
    const m = loadMigrationDeclined();
    m[cwd] = version;
    writeFileSync(MIGRATION_DECLINED_FILE, JSON.stringify(m, null, 2) + "\n", "utf8");
  } catch {
    /* best-effort */
  }
}

async function readBundleVersion(cwd: string): Promise<string | null> {
  const p = join(wikiDir(cwd), "index.md");
  if (!existsSync(p)) return null; // no bundle — nothing to migrate
  try {
    const { yaml } = parseFrontmatter(await readFile(p, "utf8"));
    const v = String(yaml.okf_version ?? "").trim();
    return v || "0.1"; // stamp lost → treat as legacy
  } catch {
    return "0.1";
  }
}

async function bumpBundleVersion(cwd: string, to: string): Promise<void> {
  const p = join(wikiDir(cwd), "index.md");
  if (!existsSync(p)) return;
  const text = await readFile(p, "utf8");
  if (/^okf_version:.*$/m.test(text)) {
    await writeFile(p, text.replace(/^okf_version:.*$/m, `okf_version: "${to}"`), "utf8");
  } else {
    await writeFile(p, `---\nokf_version: "${to}"\n---\n\n${text}`, "utf8");
  }
}

interface MigrationResult { from: string; to: string; steps: string[] }

async function migrateBundle(cwd: string): Promise<MigrationResult | null> {
  const from = await readBundleVersion(cwd);
  if (!from || from === BUNDLE_VERSION) return null;
  const root = wikiDir(cwd);
  const steps: string[] = [];
  for (const d of ["changelog", "journal"]) {
    if (!existsSync(join(root, d))) {
      await mkdir(join(root, d), { recursive: true });
      steps.push(`created ${d}/`);
    }
  }
  const ignoreP = join(cwd, IGNORE_FILE);
  if (!existsSync(ignoreP)) {
    await writeFile(ignoreP, DEFAULT_WIKI_IGNORE, "utf8");
    steps.push("created .wiki_ignore");
  }
  if (!existsSync(join(root, MEMORY_FILE))) steps.push("scaffolded memory.md");
  // Derived surfaces — regenerated unconditionally (idempotent, never loses
  // authored content: both writers only add managed sections).
  try { await regenerateMemory(cwd); steps.push("regenerated memory.md"); } catch { /* best effort */ }
  try { await updateIndexNavMap(cwd); steps.push("regenerated nav map"); } catch { /* best effort */ }
  await bumpBundleVersion(cwd, BUNDLE_VERSION);
  // Journal the migration + stamp a fresh sync so our own writes don't trip
  // the staleness check next session.
  try {
    const day = new Date().toISOString().slice(0, 10);
    await appendFileSync(join(root, "log.md"), `\n## ${day} (migration)\n- **Schema**: ${from} → ${BUNDLE_VERSION} — ${steps.join("; ")}.\n`, "utf8");
  } catch { /* best effort */ }
  try {
    await writeFile(join(root, LAST_UPDATED), `# Last wiki sync\n\n${new Date().toISOString()}\n`, "utf8");
  } catch { /* best effort */ }
  return { from, to: BUNDLE_VERSION, steps };
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

export default function (pi: ExtensionAPI) {
  // WIKI_DEBUG_LOG=1: hermetic e2e seam — append every tool execution to
  // <cwd>/.wiki-debug.log so probes can be scored on BEHAVIOR (map-first vs
  // grep-first, lazy-load discipline) rather than on final answers alone.
  if (process.env.WIKI_DEBUG_LOG === "1") {
    pi.on("tool_execution_start", async (_event, ctx) => {
      try {
        const ev = _event as { toolName?: string; args?: unknown };
        const args = JSON.stringify(ev.args ?? {}).slice(0, 250);
        appendFileSync(join(ctx.cwd, ".wiki-debug.log"), `${new Date().toISOString()} START ${ev.toolName ?? "?"} ${args}\n`, "utf8");
      } catch {
        /* debug logging must never break a session */
      }
    });
    pi.on("tool_execution_end", async (_event, ctx) => {
      try {
        const ev = _event as { toolName?: string; isError?: boolean; durationMs?: number };
        if (ev.isError) {
          appendFileSync(join(ctx.cwd, ".wiki-debug.log"), `${new Date().toISOString()} END ${ev.toolName ?? "?"} ERROR (${ev.durationMs ?? "?"}ms)\n`, "utf8");
        }
      } catch {
        /* debug logging must never break a session */
      }
    });
  }

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

    // Disconnected: no init offer, no staleness check — the bundle stays on
    // disk and the /wiki viewer still works; only the proactive machinery is off.
    if (isDisconnected(cwd)) {
      ctx.ui.setStatus(FOOTER_KEY, "wiki: disconnected");
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
        const res = await initBundle(cwd);
        ctx.ui.notify("docs/wiki/ stub bundle created.", "info");
        fireAutoDoc(cwd, ctx, res.autoDocNeeded);
      } catch (e) {
        ctx.ui.notify(`wiki init failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
      return; // nothing to check yet
    }

    // F2: migrate legacy bundle schemas BEFORE staleness (the migration bumps
    // last_updated itself). Ask-first with a real UI; silent in headless/RPC
    // where dialogs can't be answered. Declines are remembered per version.
    const bundleVersion = await readBundleVersion(cwd);
    if (bundleVersion && bundleVersion !== BUNDLE_VERSION) {
      const declined = loadMigrationDeclined()[cwd];
      const canAsk = ctx.hasUI && ctx.mode !== "rpc";
      const doIt = !canAsk
        ? true // headless/RPC: additive-only migration is dialog-safe by design
        : declined === bundleVersion
          ? false // already declined for this exact version — never re-ask
          : await ctx.ui.confirm("Wiki schema update", `This wiki bundle is okf_version ${bundleVersion}; this extension ships ${BUNDLE_VERSION}. Migrate now? Additive only: missing surfaces (changelog/, journal/, memory.md, nav map) are added, existing content is never overwritten.`);
      if (doIt) {
        try {
          const migration = await migrateBundle(cwd);
          if (migration && canAsk) {
            ctx.ui.notify(`Wiki migrated ${migration.from} → ${migration.to} (${migration.steps.length} steps).`, "info");
          }
        } catch (e) {
          if (canAsk) ctx.ui.notify(`Wiki migration failed: ${e instanceof Error ? e.message : String(e)}`, "error");
        }
      } else if (canAsk) {
        saveMigrationDeclined(cwd, bundleVersion);
      }
    }

    // Ask-first update check (R8): once/24h, notify-only.
    if (ctx.hasUI && ctx.mode !== "rpc") {
      try {
        const upd = await checkForUpdate();
        if (upd) {
          ctx.ui.notify(`wikiman ${upd.latest} is available (installed ${upd.current}) — run /wiki:self-update, or: pi update git:github.com/monstrous-dev/wikiman`, "info");
        }
      } catch {
        /* never block startup */
      }
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
    if (isDisconnected(ctx.cwd)) return; // disconnected — no injection
    if (!existsSync(wikiDir(ctx.cwd))) return;
    const sys = (event.systemPrompt ?? "");
    if (sys.includes(SENTINEL) || markerInBranch(ctx)) return; // already in context
    const injection = await buildInjection(ctx.cwd, recentGitFiles(ctx.cwd));
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

  // --- agent_end: debounced fire-and-forget in-process wiki recap ---
  // Schedules (does not immediately run) one completion call that mines the
  // turn and writes notes. Cancelled if a continuation follows (see
  // agent_start / compaction_start above), so it only fires when the full
  // turn is done. Skips hidden/internal turns (suppressRecap) and trivial
  // turns (<80 chars). No subagent, no agentman — self-contained (R1).
  pi.on("agent_end", async (event, ctx) => {
    if (!ctx.isProjectTrusted()) return;
    if (!existsSync(wikiDir(ctx.cwd))) return;
    // Worktree: recap writes to the wiki — refuse (main checkout only).
    if (IS_WORKTREE) return;
    // Disconnected: no end-of-turn auto-recap.
    if (isDisconnected(ctx.cwd)) return;
    // Headless/print/JSON modes never recap unless WIKI_RECAP_IN_HEADLESS=1
    // (hermetic e2e hatch for probe sessions). RPC is ALWAYS excluded — this
    // is also the recursion guard: spawned children skip this path instead of
    // spawning recaps of their own.
    if (ctx.mode === "rpc") return;
    if (!ctx.hasUI && process.env.WIKI_RECAP_IN_HEADLESS !== "1") return;
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
    // R1: capture the model machinery synchronously — the debounced callback
    // must not touch a possibly-stale ctx. No model / no auth → silent skip
    // (the manual wiki_note_* tools remain fully usable).
    const model = (ctx as any).model;
    const modelRegistry = (ctx as any).modelRegistry;
    if (!model || !modelRegistry) return;
    if (!(modelRegistry.hasConfiguredAuth?.(model) ?? true)) return;
    const notify = (msg: string, type?: "info" | "warning" | "error") => staleSafeCtx(ctx).ui.notify(msg, type);
    const env: RecapEnv = { cwd: ctx.cwd, model, modelRegistry, notify };
    if (!ctx.hasUI) {
      // Headless hatch (WIKI_RECAP_IN_HEADLESS=1): NO debounce — pi -p exits as
      // soon as handlers resolve, so a timer dies un-fired (observed: journal
      // never landed). Run inline; pi awaits agent_end handlers, which keeps
      // the process alive until the completion returns.
      try {
        await runInlineRecap(env, turnText);
      } catch (e) {
        try { env.notify(`wiki recap failed: ${e instanceof Error ? e.message : String(e)}`, "warning"); } catch { /* stale */ }
      }
      return;
    }
    scheduleRecap(env, turnText);
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
      // R8: ids prefixed "global/" read from the agent-home wiki instead of
      // the project bundle — the global tier stays lazy-loadable.
      const isGlobal = params.concept.startsWith("global/");
      const found = await readConcept(cwd, isGlobal ? params.concept.slice("global/".length) : params.concept, isGlobal ? AGENT_WIKI : undefined);
      if (!found) {
        return {
          content: [{ type: "text" as const, text: `Not found: ${params.concept}. Call wiki_search to discover concepts.` }],
        };
      }
      let out = `# ${relative(isGlobal ? AGENT_WIKI : wikiDir(cwd), found.path).replace(/\\/g, "/")}\n\n${found.text}`;
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
    description: "Keyword search across all docs/wiki/ concepts. Multi-term ranked search: term frequency × field weights (title > path/description > body) + recency + type boost. Returns ordered results (top 15).",
    promptSnippet: "Keyword search across docs/wiki/ concepts",
    parameters: Type.Object({
      query: Type.String({ description: "Search query — one or more keywords" }),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      const cwd = ctx.cwd;
      const root = wikiDir(cwd);
      // R5: multi-term ranked search — TF × field weights (title 4 > path/desc 2
      // > body 1) + recency boost + type boost. Zero network, zero model calls.
      const terms = params.query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
      const files = await walkMd(root);
      const now = Date.now();
      const hits: { rel: string; desc: string; line: string; score: number }[] = [];
      for (const f of files) {
        if (RESERVED.has(basename(f))) continue;
        const rel = relative(root, f).replace(/\.md$/, "").replace(/\\/g, "/");
        const text = await readFile(f, "utf8");
        const { yaml, body } = parseFrontmatter(text);
        const title = (yaml.title ? String(yaml.title) : "").toLowerCase();
        const desc = (yaml.description ? String(yaml.description) : "").toLowerCase();
        const bodyL = body.toLowerCase();
        const pathL = rel.toLowerCase();
        let score = 0;
        let firstIdx = -1;
        let matchedTerm = "";
        for (const t of terms) {
          const c = (s: string) => s.split(t).length - 1;
          const s = c(title) * 4 + c(pathL) * 2 + c(desc) * 2 + c(bodyL);
          if (s === 0) continue;
          score += s;
          if (firstIdx < 0) {
            firstIdx = bodyL.indexOf(t);
            matchedTerm = t;
          }
        }
        if (score === 0) continue;
        try {
          const ageDays = (now - (await stat(f)).mtimeMs) / 86_400_000;
          if (ageDays < 7) score += 2; else if (ageDays < 30) score += 1;
        } catch {
          /* recency unknown */
        }
        const folder = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "root";
        score += TYPE_WEIGHT[folder] ?? 1;
        const line = firstIdx >= 0
          ? body.slice(Math.max(0, firstIdx - 40), firstIdx + matchedTerm.length + 40).replace(/\n/g, " ")
          : "";
        hits.push({ rel, desc: (yaml.description ? String(yaml.description) : "").trim(), line, score: Math.round(score * 10) / 10 });
      }
      hits.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
      const top = hits.slice(0, 15);
      if (top.length === 0)
        return { content: [{ type: "text" as const, text: `No concepts match "${params.query}".` }] };
      const body2 = top
        .map((h) => `- ${h.rel} (score ${h.score})${h.desc ? ` — ${h.desc}` : ""}${h.line ? `\n    …${h.line}…` : ""}`)
        .join("\n");
      return { content: [{ type: "text" as const, text: `${top.length} concept(s) match "${params.query}" (ranked):
\n${body2}` }] };
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
      // Queued-staleness completion: flip the footer from "sync queued" to
      // synced so the user sees the background sync landing.
      if (stalenessQueued) {
        stalenessQueued = false;
        try {
          ctx.ui.setStatus(FOOTER_KEY, `wiki: ${ctx.ui.theme.fg("success", "●")} synced`);
        } catch {
          /* stale ctx */
        }
      }
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
      if (isDisconnected(ctx.cwd)) {
        ctx.ui.notify("Wiki is disconnected for this folder — /wiki:reconnect first.", "warning");
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
          (task) => {
            // No agentman / no curator prompt: the session LLM performs the
            // sync itself (it has the wiki_* tools). Same suppressRecap rule
            // as the staleness steer — this hidden turn must not spawn a recap.
            suppressRecap = true;
            getApi().pi.sendMessage(
              { customType: "wiki-curator-fallback", content: curatorFallbackPrompt(task), display: false },
              { triggerTurn: true, deliverAs: "steer" },
            );
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
      if (isDisconnected(ctx.cwd)) {
        ctx.ui.notify("Wiki is disconnected for this folder — /wiki:reconnect before re-initializing.", "warning");
        return;
      }
      try {
        if (existsSync(wikiDir(ctx.cwd))) {
          const ok = ctx.hasUI ? await ctx.ui.confirm("Wiki exists", "docs/wiki/ already exists. Add missing scaffold files? Existing content is never overwritten.") : false;
          if (!ok) return;
        }
        const res = await initBundle(ctx.cwd);
        // Explicit init also upgrades a legacy bundle schema (F2).
        try { await migrateBundle(ctx.cwd); } catch { /* best effort */ }
        fireAutoDoc(ctx.cwd, ctx, res.autoDocNeeded);
        // R7 bootstrap import: offer ADR → Concept pages (ask-first, UI only).
        if (ctx.hasUI && ctx.mode !== "rpc") {
          try {
            const n = await importAdrs(ctx.cwd);
            if (n > 0) ctx.ui.notify(`Bootstrapped ${n} ADR page(s) into docs/wiki/pages/concepts/.`, "info");
          } catch {
            /* best effort */
          }
        }
        // Explicit init overrides an earlier decline.
        saveOmitted(loadOmitted().filter((d) => d !== ctx.cwd));
        ctx.ui.notify("docs/wiki/ ready — missing scaffold files added, existing content kept.", "info");
      } catch (e) {
        ctx.ui.notify(`wiki:init failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });

  // --- /wiki:stats — visibility drives trust (R7) ---
  pi.registerCommand("wiki:stats", {
    description: "Wiki stats: concept counts per folder, injection size vs budget, last sync, journal entries",
    handler: async (_args, ctx) => {
      ctx = staleSafeCtx(ctx);
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify("Project not trusted", "error");
        return;
      }
      const wd = wikiDir(ctx.cwd);
      if (!existsSync(wd)) {
        ctx.ui.notify("No docs/wiki/ found. Run /wiki:init first.", "warning");
        return;
      }
      try {
        const counts: Record<string, number> = {};
        for (const f of await walkMd(wd)) {
          const rel = relative(wd, f).replace(/\\/g, "/");
          if (RESERVED.has(basename(f))) continue;
          const folder = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "root";
          counts[folder] = (counts[folder] ?? 0) + 1;
        }
        const injection = await buildInjection(ctx.cwd);
        const chars = injection?.length ?? 0;
        const sync = await readLastUpdated(ctx.cwd);
        let journalEntries = 0;
        const journalDir = join(wd, "journal");
        if (existsSync(journalDir)) {
          for (const f of await readdir(journalDir)) {
            if (!f.endsWith(".md")) continue;
            try {
              journalEntries += (await readFile(join(journalDir, f), "utf8")).match(/^- /gm)?.length ?? 0;
            } catch {
              /* skip unreadable */
            }
          }
        }
        const countsLine = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", ") || "none";
        ctx.ui.notify(
          [
            "wiki stats",
            `  concepts: ${countsLine}`,
            `  injection: ${chars}/${INJECTION_MAX_CHARS} chars (~${Math.ceil(chars / 4)} tokens)`,
            `  last sync: ${sync ? new Date(sync).toISOString() : "never"}`,
            `  journal entries: ${journalEntries}`,
          ].join("\n"),
          "info",
        );
      } catch (e) {
        ctx.ui.notify(`wiki:stats failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });

  // --- /wiki:digest — weekly roll-up (R7) ---
  pi.registerCommand("wiki:digest", {
    description: "Digest: last-7-days changelog entries + fresh learnings, written to docs/wiki/digest.md",
    handler: async (_args, ctx) => {
      ctx = staleSafeCtx(ctx);
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify("Project not trusted", "error");
        return;
      }
      const wd = wikiDir(ctx.cwd);
      if (!existsSync(wd)) {
        ctx.ui.notify("No docs/wiki/ found. Run /wiki:init first.", "warning");
        return;
      }
      try {
        const cutoff = Date.now() - 7 * 86_400_000;
        const chunks: string[] = [];
        const clDir = join(wd, "changelog");
        if (existsSync(clDir)) {
          for (const f of (await readdir(clDir)).filter((x) => x.endsWith(".jsonl")).sort()) {
            const raw = await readFile(join(clDir, f), "utf8");
            for (const line of raw.split("\n")) {
              if (!line.trim()) continue;
              try {
                const e = JSON.parse(line) as Record<string, unknown>;
                const ts = Date.parse(String(e.at ?? e.timestamp ?? ""));
                if (!Number.isNaN(ts) && ts >= cutoff) {
                  chunks.push(`- **${String(e.category ?? "Changed")}**: ${String(e.user ?? e.what ?? "").slice(0, 160)}`);
                }
              } catch {
                /* skip malformed line */
              }
            }
          }
        }
        const learnDir = join(wd, "learnings");
        const fresh: string[] = [];
        if (existsSync(learnDir)) {
          for (const f of await walkMd(learnDir)) {
            if (basename(f) === "index.md") continue;
            try {
              if ((await stat(f)).mtimeMs < cutoff) continue;
              const { yaml } = parseFrontmatter(await readFile(f, "utf8"));
              fresh.push(`- ${String(yaml.title ?? basename(f, ".md"))}`);
            } catch {
              /* skip unreadable */
            }
          }
        }
        if (chunks.length === 0 && fresh.length === 0) {
          ctx.ui.notify("Nothing new in the last 7 days — wiki is quiet.", "info");
          return;
        }
        const now = new Date().toISOString();
        const md = [
          buildFrontmatter({ type: "Artifact", title: "Weekly digest", description: "Roll-up of the last 7 days of wiki activity.", timestamp: now }),
          `# Weekly digest — ${now.slice(0, 10)}`,
          "",
          chunks.length ? `## Changelog (last 7 days)\n\n${chunks.join("\n")}` : "",
          fresh.length ? `## Fresh learnings\n\n${fresh.slice(0, 15).join("\n")}` : "",
        ].filter(Boolean).join("\n\n");
        await writeFile(join(wd, "digest.md"), md + "\n", "utf8");
        ctx.ui.notify(`Digest written: docs/wiki/digest.md (${chunks.length} changelog, ${fresh.length} fresh learnings).`, "info");
      } catch (e) {
        ctx.ui.notify(`wiki:digest failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });

  // --- /wiki:self-update — update the extension itself (R8 companion) ---
  pi.registerCommand("wiki:self-update", {
    description: "Update the wikiman extension to the latest published version (runs pi update; then /reload or restart pi to load it)",
    handler: async (_args, ctx) => {
      ctx = staleSafeCtx(ctx);
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify("Project not trusted", "error");
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify("/wiki:self-update needs the TUI (it asks first). Run: pi update git:github.com/monstrous-dev/wikiman", "warning");
        return;
      }
      const ok = await ctx.ui.confirm(
        "Update wikiman",
        "Run 'pi update git:github.com/monstrous-dev/wikiman' now?\n\nSafe: pi keeps running the old code until you /reload or restart — nothing breaks mid-session.",
      );
      if (!ok) return;
      try {
        ctx.ui.setStatus(FOOTER_KEY, "wiki: updating extension...");
        const out = execSync("pi update git:github.com/monstrous-dev/wikiman", {
          timeout: 180_000,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        try {
          writeFileSync(UPDATE_CHECK_FILE, JSON.stringify({ at: Date.now(), latest: "" }), "utf8");
        } catch {
          /* throttle state is best-effort */
        }
        ctx.ui.setStatus(FOOTER_KEY, undefined);
        const tail = out.trim() ? "\n  " + out.trim().split(/\r?\n/).slice(-3).join("\n  ") : "";
        ctx.ui.notify(`wikiman updated.${tail}\nRun /reload or restart pi to load the new version.`, "info");
      } catch (e) {
        ctx.ui.setStatus(FOOTER_KEY, undefined);
        const msg = e instanceof Error ? e.message : String(e);
        ctx.ui.notify(`Self-update failed: ${msg.slice(0, 200)}\nTry manually: pi update git:github.com/monstrous-dev/wikiman`, "error");
      }
    },
  });

  // --- /wiki:disconnect — turn the extension OFF for this folder (bundle kept) ---
  pi.registerCommand("wiki:disconnect", {
    description: "Disconnect the wiki for this folder — stops context injection, staleness checks, and end-of-turn recap; docs/wiki/ is kept untouched",
    handler: async (_args, ctx) => {
      // ctx is used after awaits? No — but disconnect cancels a pending recap
      // timer and touches the footer; guard stale ctx for uniformity.
      ctx = staleSafeCtx(ctx);
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify("Project not trusted", "error");
        return;
      }
      if (IS_WORKTREE) {
        ctx.ui.notify("Wiki machinery is already read-only in a worktree — nothing to disconnect.", "warning");
        return;
      }
      const list = loadDisconnected();
      if (list.includes(ctx.cwd)) {
        ctx.ui.notify("Wiki is already disconnected for this folder.", "info");
        return;
      }
      list.push(ctx.cwd);
      saveDisconnected(list);
      clearRecapTimer(); // cancel any recap already scheduled for this turn
      try { ctx.ui.setStatus(FOOTER_KEY, "wiki: disconnected"); } catch { /* stale */ }
      ctx.ui.notify("Wiki disconnected. docs/wiki/ is untouched and wiki_get/search still work; /wiki:reconnect to re-enable.", "info");
    },
  });

  // --- /wiki:reconnect — turn the extension back ON for this folder ---
  pi.registerCommand("wiki:reconnect", {
    description: "Reconnect the wiki for this folder — resumes context injection, staleness checks, and end-of-turn recap",
    handler: async (_args, ctx) => {
      ctx = staleSafeCtx(ctx);
      if (!ctx.isProjectTrusted()) {
        ctx.ui.notify("Project not trusted", "error");
        return;
      }
      const list = loadDisconnected();
      if (!list.includes(ctx.cwd)) {
        ctx.ui.notify("Wiki is not disconnected for this folder.", "info");
        return;
      }
      saveDisconnected(list.filter((d) => d !== ctx.cwd));
      try { ctx.ui.setStatus(FOOTER_KEY, undefined); } catch { /* stale */ }
      ctx.ui.notify("Wiki reconnected. Injection and recap resume; staleness re-checks next session — or run /wiki:update now.", "info");
    },
  });
}

// ---------------------------------------------------------------------------
// (cwd is now passed via each tool's ctx; no module-level slot needed.)

