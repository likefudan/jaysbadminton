// Reads the JSON reports of a Stress test run (.github/workflows/stress.yml) and prints, as Markdown,
// every test that failed at least once: how many of its runs failed, and its first error.
// Also writes stress-summary.json. Usage: node scripts/stress-summary.mjs <folder with the reports>
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2] ?? "results";
const tests = new Map(); // key → { suite, name, runs, failures, error }
const broken = []; // whole rounds that ended without results (server didn't start, crash, …)
let reports = 0;

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".json") && /\/stress\//.test(p) ? [p] : [];
  });
}

function note(suite, name, failed, error) {
  const key = `${suite} ${name}`;
  const t = tests.get(key) ?? { suite, name, runs: 0, failures: 0, error: "" };
  t.runs++;
  if (failed) {
    t.failures++;
    if (!t.error && error) t.error = firstLine(error);
  }
  tests.set(key, t);
}

function firstLine(text) {
  // Drop terminal colours; keep the first line that says something.
  const clean = String(text).replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
  const line =
    clean
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !/^at /.test(l)) ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

function playwright(report, path) {
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        if (!results.length || results.every((r) => r.status === "skipped")) continue;
        const bad = results.find((r) => r.status !== "passed" && r.status !== "skipped");
        note("e2e", `${spec.file}:${spec.line} › ${spec.title}`, !!bad, bad?.error?.message ?? bad?.status);
      }
    }
    for (const s of suite.suites ?? []) walk(s);
  };
  for (const s of report.suites ?? []) walk(s);
  for (const e of report.errors ?? []) broken.push(`${path}: ${firstLine(e.message ?? e)}`);
}

function vitest(report, path) {
  for (const file of report.testResults ?? []) {
    const name = relative(process.cwd(), file.name).replace(/^.*?(test\/)/, "$1");
    const cases = file.assertionResults ?? [];
    for (const c of cases) {
      if (c.status === "skipped" || c.status === "pending" || c.status === "todo") continue;
      note("unit", `${name} › ${c.fullName ?? c.title}`, c.status === "failed", c.failureMessages?.[0]);
    }
    // A file that failed before any test ran (an import error, a hook that threw).
    if (file.status === "failed" && !cases.some((c) => c.status === "failed")) {
      note("unit", `${name} (the file itself)`, true, file.message);
    }
  }
  if (report.success === false && !(report.testResults ?? []).length) broken.push(`${path}: no results`);
}

for (const path of files(root)) {
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    broken.push(`${path}: unreadable report`);
    continue;
  }
  reports++;
  if (report.testResults) vitest(report, path);
  else playwright(report, path);
}

const flaky = [...tests.values()]
  .filter((t) => t.failures > 0)
  .sort((a, b) => b.failures / b.runs - a.failures / a.runs || a.name.localeCompare(b.name));
const runs = [...tests.values()].reduce((n, t) => n + t.runs, 0);

const out = [];
out.push("## Stress test", "");
out.push(`${reports} reports, ${tests.size} tests, ${runs} test runs.`, "");
if (!flaky.length) out.push("**No test failed.**");
else {
  out.push(`**${flaky.length} test(s) failed at least once:**`, "");
  out.push("| Failed | Suite | Test | First error |", "| ---: | --- | --- | --- |");
  const cell = (s) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  for (const t of flaky) {
    out.push(`| ${t.failures}/${t.runs} | ${t.suite} | ${cell(t.name)} | ${cell(t.error)} |`);
  }
}
if (broken.length) out.push("", "**Rounds with errors outside a test:**", "", ...broken.map((b) => `- ${b}`));
console.log(out.join("\n"));
writeFileSync("stress-summary.json", `${JSON.stringify({ reports, runs, flaky, broken }, null, 2)}\n`);
