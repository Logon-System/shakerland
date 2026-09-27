#!/usr/bin/env node
/**
 * Checks a dataset's completeness: compares expected image filenames (from
 * tests.json + archs.json) with actual files in PictureBank.
 *
 * By default only missing files are reported (plus unrecognized "extra"
 * files, listed as-is). Pass --fuzzy to also propose renames for missing
 * files using Levenshtein distance against the extra files, and write out
 * mismatches-report.txt / rename-suggestions.sh.
 *
 * Matching is constrained to the same {testId}_CRTC{n} prefix so we never
 * propose cross-test or cross-CRTC renames.
 *
 * Usage:
 *   node scripts/find-image-mismatches.js [--picturedir /path/to/PictureBank] [--fuzzy]
 *   node scripts/find-image-mismatches.js --dir /path/to/PictureBank/amspirit/1.2 [--fuzzy]
 *
 * Exit code: non-zero if any expected file is missing (extra files don't count).
 */

const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getFlag(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}
const FUZZY = args.includes('--fuzzy');

const pictureDirFlag = getFlag('--picturedir');
const PICTURE_DIR = pictureDirFlag
  ? path.resolve(pictureDirFlag)
  : path.resolve(__dirname, '../../PictureBank');

const dirFlag = getFlag('--dir');

const DATA_DIR = path.resolve(__dirname, '../data');

// ── Levenshtein ───────────────────────────────────────────────────────────────

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// ── Filename parser ───────────────────────────────────────────────────────────
// Filename pattern: {id}_CRTC{n}[_{subfolder}]_{subTest}.webp
// The prefix we use for grouping is "{id}_CRTC{n}" — i.e. everything up to and
// including the CRTC number.  We extract it with a simple regex.

const PREFIX_RE = /^([A-Z0-9]+_CRTC\d+)/;

function getPrefix(filename) {
  const m = PREFIX_RE.exec(filename);
  return m ? m[1] : null;
}

// ── File helpers ──────────────────────────────────────────────────────────────

function getExpectedSet(tests) {
  const expected = new Set();
  for (const test of tests) {
    for (const sub of test.subtests) {
      for (const crtc of sub.crtcs) {
        const parts = [test.id, 'CRTC' + crtc];
        if (sub.subfolder) parts.push(sub.subfolder);
        parts.push(sub.subTest);
        expected.add(parts.join('_') + '.webp');
      }
    }
  }
  return expected;
}

function getActualFiles(dir) {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).filter(f => f.endsWith('.webp')));
}

// Group filenames by their {id}_CRTC{n} prefix
function groupByPrefix(files) {
  const map = new Map();
  for (const f of files) {
    const p = getPrefix(f);
    if (!p) continue;
    if (!map.has(p)) map.set(p, []);
    map.get(p).push(f);
  }
  return map;
}

// ── Target resolution ─────────────────────────────────────────────────────────
// A "target" is one { id, version, dir } dataset directory to check.

const archs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'archs.json'), 'utf8'));
const tests = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'tests.json'), 'utf8'));

let targets;

if (dirFlag) {
  const targetDir = path.resolve(dirFlag);
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    console.error(`Error: directory not found: ${targetDir}`);
    process.exit(1);
  }

  const matched = archs.find(a => path.resolve(PICTURE_DIR, a.id, a.version) === targetDir);
  if (!matched) {
    console.warn(`Warning: "${targetDir}" doesn't match any arch/version in archs.json — checking it anyway.`);
  }

  targets = [{
    id: matched ? matched.id : path.basename(path.dirname(targetDir)),
    version: matched ? matched.version : path.basename(targetDir),
    dir: targetDir,
  }];
} else {
  targets = archs.map(a => ({ id: a.id, version: a.version, dir: path.join(PICTURE_DIR, a.id, a.version) }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

const expectedSet = getExpectedSet(tests);

const reportLines = [];
const renameLines = [
  '#!/bin/bash',
  '# Auto-generated rename suggestions — REVIEW BEFORE EXECUTING',
  '# mv -n = no overwrite (safe)',
  '',
];

let totalMissing = 0, totalExtra = 0, totalMatched = 0, totalNoMatch = 0;

for (const target of targets) {
  const label = `${target.id}/${target.version}`;
  const actual = getActualFiles(target.dir);

  const missing = [...expectedSet].filter(f => !actual.has(f)).sort();
  const extra   = [...actual].filter(f => !expectedSet.has(f)).sort();

  if (missing.length === 0 && extra.length === 0) continue;

  totalMissing += missing.length;
  totalExtra += extra.length;

  console.log(`\n${label}  (${missing.length} missing, ${extra.length} unrecognized)`);
  if (missing.length) {
    console.log('  Missing:');
    for (const m of missing) console.log(`    ${m}`);
  }
  if (extra.length) {
    console.log('  Extra (unrecognized):');
    for (const e of extra) console.log(`    ${e}`);
  }

  if (!FUZZY || missing.length === 0) continue;

  // Group extra files by prefix for constrained matching
  const extraByPrefix = groupByPrefix(extra);

  // Distance above which a match is flagged as suspicious
  const SAFE_DIST = 5;

  // Track which extra files have already been assigned to avoid 1-to-many
  const usedExtra = new Set();

  const rows = [];
  for (const m of missing) {
    const prefix = getPrefix(m);
    const candidates = prefix ? (extraByPrefix.get(prefix) || []) : [];
    const available  = candidates.filter(c => !usedExtra.has(c));

    if (available.length === 0) {
      rows.push({ missing: m, match: null, dist: null, reason: candidates.length > 0 ? 'already-used' : 'no-candidate' });
      continue;
    }

    // Pick closest by Levenshtein
    let best = null, bestDist = Infinity;
    for (const c of available) {
      const d = levenshtein(m, c);
      if (d < bestDist) { bestDist = d; best = c; }
    }

    usedExtra.add(best);
    rows.push({ missing: m, match: best, dist: bestDist, reason: null });
  }

  reportLines.push(`\n${'═'.repeat(72)}`);
  reportLines.push(`ARCH: ${label}  (${missing.length} missing, ${extra.length} unrecognized)`);
  reportLines.push('═'.repeat(72));
  renameLines.push(`\n# ── ${label} ${'─'.repeat(50 - label.length)}`);

  let archMatched = 0, archNoMatch = 0;
  for (const row of rows) {
    if (row.match) {
      archMatched++;
      totalMatched++;
      const suspicious = row.dist > SAFE_DIST;
      const tag = suspicious ? '  ⚠ SUSPICIOUS' : '';
      reportLines.push(`  MISSING : ${row.missing}`);
      reportLines.push(`  SUGGEST : ${row.match}  [dist=${row.dist}]${tag}`);
      reportLines.push('');
      const mvCmd = `mv -n "${target.dir}/${row.match}" "${target.dir}/${row.missing}"`;
      renameLines.push(suspicious ? `# SUSPICIOUS (dist=${row.dist}): ${mvCmd}` : mvCmd);
    } else {
      archNoMatch++;
      totalNoMatch++;
      const note = row.reason === 'already-used' ? '(candidate already used)' : '(no file with same test+CRTC)';
      reportLines.push(`  MISSING : ${row.missing}`);
      reportLines.push(`  NO MATCH ${note}`);
      reportLines.push('');
      renameLines.push(`# NO MATCH: ${row.missing}  ${note}`);
    }
  }

  reportLines.push(`  → ${archMatched} rename suggestions, ${archNoMatch} truly absent`);
}

console.log(`\nTotal: ${totalMissing} missing | ${totalExtra} unrecognized`);

if (FUZZY) {
  reportLines.unshift(
    `Image mismatch report — ${new Date().toISOString()}`,
    `PictureBank: ${PICTURE_DIR}`,
    `Total missing: ${totalMissing}  |  Rename suggestions: ${totalMatched}  |  Truly absent: ${totalNoMatch}`,
    '',
  );

  const reportPath = path.resolve(__dirname, '../mismatches-report.txt');
  const renamePath = path.resolve(__dirname, '../rename-suggestions.sh');

  fs.writeFileSync(reportPath, reportLines.join('\n') + '\n');
  fs.writeFileSync(renamePath, renameLines.join('\n') + '\n');
  fs.chmodSync(renamePath, 0o755);

  console.log(`Report  : ${reportPath}`);
  console.log(`Renames : ${renamePath}`);
}

process.exit(totalMissing > 0 ? 1 : 0);
