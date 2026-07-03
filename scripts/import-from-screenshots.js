#!/usr/bin/env node
/**
 * Maps still-missing webp images to source files in the SCREENSHOTS directory,
 * then generates a shell script of cwebp conversion commands.
 *
 * Mapping rules:
 *   archId  → SCREENSHOTS/{EMULATOR}/   (amspirit→AMSPIRIT, ace→ACE, …)
 *   testId  → "22{series} TEST {key}"   (B5→"22B TEST 5", BRETURN→"22B TEST RETURN", …)
 *   CRTC N  → "CRTC N/"
 *   subfolder (from evals.json) → exact subdir, or closest-match if not found
 *   subTest → "{subTest}.bmp" | ".png" | ".jpg"   (tried in that order)
 *
 * Skips files under _OLD/ subdirectories.
 *
 * Usage: node scripts/import-from-screenshots.js [--picturedir PATH] [--screenshotsdir PATH]
 * Output:
 *   - screenshots-report.txt   : per-arch findings
 *   - import-screenshots.sh    : cwebp commands ready to run
 */

const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

const PICTURE_DIR     = flag('--picturedir')     || path.resolve(__dirname, '../../PictureBank');
const SCREENSHOTS_DIR = flag('--screenshotsdir') || path.resolve(__dirname, '../../SCREENSHOTS');
const DATA_DIR        = path.resolve(__dirname, '../data');

// ── Arch → SCREENSHOTS folder mapping ────────────────────────────────────────

const ARCH_TO_FOLDER = {
  amspirit: 'AMSPIRIT',
  ace:      'ACE',
  winape:   'WINAPE',
  cpcec:    'CPCEC',
  // cpc (real hardware) has a different structure — skip for now
};

// ── Test ID → folder name mapping ────────────────────────────────────────────
// Folder pattern: "22{SERIES} TEST {KEY}" where KEY may have "(note)" to strip.
// Test ID = SERIES + KEY (both uppercased, no spaces).

function folderToTestId(folderName) {
  const m = /^22([A-D]) TEST (.+)$/i.exec(folderName);
  if (!m) return null;
  const series = m[1].toUpperCase();
  const key    = m[2].replace(/\s*\([^)]*\)/g, '').trim(); // strip "(ZERO)" etc.
  return series + key;
}

// Build lookup: testId → actual folder name on disk (per arch dir)
function buildTestIdMap(archScreenshotsDir) {
  const map = new Map();
  if (!fs.existsSync(archScreenshotsDir)) return map;
  for (const entry of fs.readdirSync(archScreenshotsDir)) {
    const id = folderToTestId(entry);
    if (id) map.set(id, entry);
  }
  return map;
}

// ── Levenshtein (for subfolder fallback) ─────────────────────────────────────

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

function bestSubfolderMatch(wanted, available, maxDist = 4) {
  let best = null, bestDist = Infinity;
  for (const a of available) {
    const d = levenshtein(wanted, a);
    if (d < bestDist) { bestDist = d; best = a; }
  }
  return bestDist <= maxDist ? { dir: best, dist: bestDist } : null;
}

// ── Source file finder ───────────────────────────────────────────────────────

const EXTS = ['bmp', 'png', 'jpg', 'jpeg'];

function findSourceFile(dir, baseName) {
  for (const ext of EXTS) {
    // Case-insensitive search (filesystems may vary)
    const candidates = [
      path.join(dir, `${baseName}.${ext}`),
      path.join(dir, `${baseName}.${ext.toUpperCase()}`),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  // Fallback: list dir and match case-insensitively
  if (!fs.existsSync(dir)) return null;
  const lowerBase = baseName.toLowerCase();
  for (const f of fs.readdirSync(dir)) {
    const noExt = f.replace(/\.[^.]+$/, '').toLowerCase();
    const ext   = f.split('.').pop().toLowerCase();
    if (noExt === lowerBase && EXTS.includes(ext)) {
      return path.join(dir, f);
    }
  }
  return null;
}

// List immediate child dirs (excluding _OLD)
function listSubdirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => {
    if (f.startsWith('_')) return false;
    return fs.statSync(path.join(dir, f)).isDirectory();
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

const archs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'archs.json'), 'utf8'));
const evals = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'evals.json'), 'utf8'));

const reportLines = [];
const convertLines = [
  '#!/bin/bash',
  '# Auto-generated import from SCREENSHOTS — REVIEW BEFORE EXECUTING',
  '# Converts bmp/png/jpg to webp with quality 90.',
  '# mkdir -p creates destination dirs as needed.',
  '',
];

let totalMissing = 0, totalFound = 0, totalNotFound = 0;

for (const arch of archs) {
  const ssFolder = ARCH_TO_FOLDER[arch.id];
  if (!ssFolder) continue;

  const pbDir = path.join(PICTURE_DIR, arch.id, arch.version);
  const ssDir = path.join(SCREENSHOTS_DIR, ssFolder);
  const testIdMap = buildTestIdMap(ssDir);

  // Collect rows: one per (eval × crtc) that is missing from PictureBank
  const rows = [];
  for (const ev of evals) {
    for (const crtc of ev.crtcs) {
      const parts = [ev.id, 'CRTC' + crtc];
      if (ev.subfolder) parts.push(ev.subfolder);
      parts.push(ev.subTest);
      const webpName = parts.join('_') + '.webp';

      if (fs.existsSync(path.join(pbDir, webpName))) continue; // already there

      totalMissing++;
      rows.push({ ev, crtc, webpName });
    }
  }

  if (rows.length === 0) continue;

  reportLines.push(`\n${'═'.repeat(72)}`);
  reportLines.push(`ARCH: ${arch.id}/${arch.version}  (${rows.length} missing)`);
  reportLines.push('═'.repeat(72));
  convertLines.push(`\n# ── ${arch.id}/${arch.version} ${'─'.repeat(50 - arch.id.length - arch.version.length)}`);
  convertLines.push(`mkdir -p "${pbDir}"`);

  let archFound = 0, archNotFound = 0;

  for (const { ev, crtc, webpName } of rows) {
    const testFolder = testIdMap.get(ev.id);
    if (!testFolder) {
      reportLines.push(`  ${webpName}`);
      reportLines.push(`  → NO TEST FOLDER for "${ev.id}" in ${ssFolder}/`);
      reportLines.push('');
      convertLines.push(`# NO FOLDER: ${webpName}`);
      archNotFound++;
      totalNotFound++;
      continue;
    }

    const crtcDir = path.join(ssDir, testFolder, `CRTC ${crtc}`);

    // Determine where to look for the source file
    let sourceFile = null;
    let subfolderNote = '';

    if (ev.subfolder) {
      // Try exact subfolder first
      const exactDir = path.join(crtcDir, ev.subfolder);
      sourceFile = findSourceFile(exactDir, ev.subTest);

      if (!sourceFile) {
        // Try Levenshtein match on available subdirs
        const subdirs = listSubdirs(crtcDir);
        const match   = bestSubfolderMatch(ev.subfolder, subdirs);
        if (match) {
          sourceFile   = findSourceFile(path.join(crtcDir, match.dir), ev.subTest);
          subfolderNote = ` [subfolder: "${ev.subfolder}"→"${match.dir}" dist=${match.dist}]`;
        }
      }
    } else {
      // No subfolder: files are directly in crtcDir
      // But also check: if crtcDir has subdirs and no direct file, warn
      sourceFile = findSourceFile(crtcDir, ev.subTest);
    }

    reportLines.push(`  ${webpName}`);

    if (sourceFile) {
      archFound++;
      totalFound++;
      const rel = path.relative(SCREENSHOTS_DIR, sourceFile);
      reportLines.push(`  → ${rel}${subfolderNote}`);
      reportLines.push('');
      convertLines.push(`cwebp -q 90 "${sourceFile}" -o "${path.join(pbDir, webpName)}"`);
    } else {
      archNotFound++;
      totalNotFound++;
      const rel = path.relative(SCREENSHOTS_DIR, crtcDir);
      const note = ev.subfolder ? ` (in ${ev.subfolder}/)` : '';
      reportLines.push(`  → NOT FOUND in ${rel}${note}`);
      reportLines.push('');
      convertLines.push(`# NOT FOUND: ${webpName}`);
    }
  }

  reportLines.push(`  → ${archFound} sources found, ${archNotFound} not found`);
}

reportLines.unshift(
  `SCREENSHOTS import report — ${new Date().toISOString()}`,
  `PictureBank:  ${PICTURE_DIR}`,
  `Screenshots:  ${SCREENSHOTS_DIR}`,
  `Total missing: ${totalMissing}  |  Sources found: ${totalFound}  |  Not found: ${totalNotFound}`,
  '',
);

const reportPath  = path.resolve(__dirname, '../screenshots-report.txt');
const convertPath = path.resolve(__dirname, '../import-screenshots.sh');

fs.writeFileSync(reportPath,  reportLines.join('\n') + '\n');
fs.writeFileSync(convertPath, convertLines.join('\n') + '\n');
fs.chmodSync(convertPath, 0o755);

console.log(`Report  : ${reportPath}`);
console.log(`Convert : ${convertPath}`);
console.log(`Total   : ${totalMissing} missing | ${totalFound} sources found | ${totalNotFound} not found`);
