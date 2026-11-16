// Runs one pi probe session in the fixture project and captures the transcript.
// Usage: node run-probe.mjs <probeId> "<prompt>" [--fresh]
// Transcript: C:\Users\PTW\wikiman-e2e\transcripts\<probeId>.txt
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = "C:\\Users\\PTW\\wikiman-e2e\\acme-ops";
const OUT = "C:\\Users\\PTW\\wikiman-e2e\\transcripts";

const [, , probeId, ...rest] = process.argv;
const prompt = rest.join(" ");
if (!probeId || !prompt) {
  console.error("usage: node run-probe.mjs <probeId> \"<prompt>\"");
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
// Evidence hygiene: clear the shared debug log BEFORE the run so this probe's
// .tools.log contains ONLY its own session's tool calls (contaminated logs
// caused critics to grade another probe's behavior in round 1).
try {
  rmSync(join(FIXTURE, ".wiki-debug.log"), { force: true });
} catch { /* ignore */ }
// shell:true joins argv raw — the prompt MUST carry its own cmd.exe quoting or
// any dash-token inside ("the -f flag") becomes a pi flag ("Unknown option: -f").
const quoted = `"${prompt.replace(/"/g, "''")}"`;
const t0 = Date.now();
const res = spawnSync("pi", ["-p", quoted], {
  cwd: FIXTURE,
  encoding: "utf8",
  timeout: 360_000,
  shell: true, // Windows: resolve pi.cmd
  env: { ...process.env, WIKI_RECAP_IN_HEADLESS: "1", WIKI_DEBUG_LOG: "1" },
});
const dt = Math.round((Date.now() - t0) / 1000);

const header = [
  `probe: ${probeId}`,
  `prompt: ${prompt}`,
  `exit: ${res.status}  duration: ${dt}s`,
  `--- transcript ---`,
].join("\n");
const body = (res.stdout ?? "") + (res.stderr ? "\n[stderr]\n" + res.stderr : "");
const file = join(OUT, `${probeId}.txt`);
writeFileSync(file, header + "\n" + body, "utf8");
// Preserve per-probe behavior evidence (the next probe overwrites .wiki-debug.log).
try {
  const dbg = join(FIXTURE, ".wiki-debug.log");
  if (existsSync(dbg)) {
    copyFileSync(dbg, join(OUT, `${probeId}.tools.log`));
  }
} catch { /* evidence copy is best-effort */ }
console.log(`saved ${file} (exit ${res.status}, ${dt}s, ${body.length} chars)`);
