#!/usr/bin/env node
/**
 * Compares expected image filenames (from evals.json + archs.json) with actual
 * files in PictureBank, then proposes renames using Levenshtein distance.
 *
 * Matching is constrained to the same {testId}_CRTC{n} prefix so we never
 * propose cross-test or cross-CRTC renames.
 *
 * Usage: node scripts/find-image-mismatches.js [--picturedir /path/to/PictureBank]
 * Output:
 *   - mismatches-report.txt  : human-readable findings per arch
 *   - rename-suggestions.sh  : shell script with mv commands
 */

const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const pictureDirFlag = args.indexOf('--picturedir');
const PICTURE_DIR = pictureDirFlag !== -1
  ? args[pictureDirFlag + 1]
  : path.resolve(__dirname, '../../PictureBank');

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

function getExpectedSet(evals) {
  const expected = new Set();
  for (const ev of evals) {
    for (const crtc of ev.crtcs) {
      const parts = [ev.id, 'CRTC' + crtc];
      if (ev.subfolder) parts.push(ev.subfolder);
      parts.push(ev.subTest);
      expected.add(parts.join('_') + '.webp');
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

// ── Main ──────────────────────────────────────────────────────────────────────

const archs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'archs.json'), 'utf8'));
const evals = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'evals.json'), 'utf8'));

const expectedSet = getExpectedSet(evals);

const reportLines = [];
const renameLines = [
  '#!/bin/bash',
  '# Auto-generated rename suggestions — REVIEW BEFORE EXECUTING',
  '# mv -n = no overwrite (safe)',
  '',
];

let totalMissing = 0, totalMatched = 0, totalNoMatch = 0, totalAlreadyUsed = 0;

for (const arch of archs) {
  const archDir = path.join(PICTURE_DIR, arch.id, arch.version);
  const actual  = getActualFiles(archDir);

  const missing = [...expectedSet].filter(f => !actual.has(f)).sort();
  const extra   = [...actual].filter(f => !expectedSet.has(f));

  if (missing.length === 0) continue;

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
  reportLines.push(`ARCH: ${arch.id}/${arch.version}  (${missing.length} missing, ${extra.length} unrecognized)`);
  reportLines.push('═'.repeat(72));
  renameLines.push(`\n# ── ${arch.id}/${arch.version} ${'─'.repeat(50 - arch.id.length - arch.version.length)}`);

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
      const mvCmd = `mv -n "${archDir}/${row.match}" "${archDir}/${row.missing}"`;
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
    totalMissing++;
  }

  reportLines.push(`  → ${archMatched} rename suggestions, ${archNoMatch} truly absent`);
}

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
console.log(`Total   : ${totalMissing} missing | ${totalMatched} rename suggestions | ${totalNoMatch} truly absent`);
