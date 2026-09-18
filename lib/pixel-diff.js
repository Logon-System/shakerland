// Pixel-diff engine for the /compare debug tool: given two "runs" (subtrees
// of RUNS_DIR, each a tree of PNG/WebP captures from a headless amspirit-lite
// run against one core build, or a PictureBank arch/version tree), compare
// matching files pixel-by-pixel.
//
// Not related to shakerland's PictureBank/tests.json dataset (that compares
// emulators/real-hardware by test id) — RUNS_DIR trees are produced by
// scripts/capture-run.sh and matched purely by relative path (extension
// ignored, since a PNG run and a WebP run can otherwise hold the exact same
// shots — e.g. a headless PNG capture vs. a PictureBank WebP reference).

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const webp = require('@cwasm/webp');

const IMAGE_EXTS = new Set(['.png', '.webp']);

// List every .png/.webp under `dir`, as paths relative to `dir` (posix-style,
// with extension, sorted).
function listImagesRecursive(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  (function walk(abs, rel) {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const entryAbs = path.join(abs, entry.name);
      const entryRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(entryAbs, entryRel);
      else if (entry.isFile() && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        out.push(entryRel);
      }
    }
  })(dir, '');
  return out.sort();
}

// Kept for backwards compatibility with callers that only care about PNGs.
function listPngsRecursive(dir) {
  return listImagesRecursive(dir).filter(rel => rel.toLowerCase().endsWith('.png'));
}

// Strip the extension so a PNG on one side can match a WebP on the other
// (e.g. "A_CRTC0/A0_1_1.png" -> "A_CRTC0/A0_1_1").
function stem(rel) {
  const ext = path.extname(rel);
  return rel.slice(0, rel.length - ext.length);
}

// List the available "run" identifiers under RUNS_DIR. Since RUNS_DIR is
// PictureBank by default (captures worth keeping land in <archId>/<version>/,
// same convention as archs.json), a run is normally two levels deep, e.g.
// "amspirit/fork-3d52bad10e7d". A directory one level deep that already
// contains images directly (ad-hoc/legacy flat run names) is also listed, for
// quick local comparisons that don't go through PictureBank.
function listRuns(runsDir) {
  if (!fs.existsSync(runsDir)) return [];
  const runs = [];
  for (const top of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!top.isDirectory()) continue;
    const topAbs = path.join(runsDir, top.name);
    const children = fs.readdirSync(topAbs, { withFileTypes: true });
    const subDirs = children.filter(e => e.isDirectory());
    if (subDirs.length > 0) {
      for (const sub of subDirs) runs.push(top.name + '/' + sub.name);
    } else if (listImagesRecursive(topAbs).length > 0) {
      runs.push(top.name);
    }
  }
  return runs.sort();
}

// Decode a PNG or WebP file into pngjs' { width, height, data (RGBA) } shape,
// whichever format the extension says it is.
function readImage(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.webp') {
    const { width, height, data } = webp.decode(fs.readFileSync(file));
    return { width, height, data };
  }
  return PNG.sync.read(fs.readFileSync(file));
}

// Compare every PNG/WebP under runsDir/runA against runsDir/runB (matched by
// relative path, ignoring extension). Returns { results, summary }, results
// sorted worst-first.
function compareRuns(runsDir, runA, runB, opts = {}) {
  const threshold = opts.threshold ?? 0.1;
  const dirA = path.join(runsDir, runA);
  const dirB = path.join(runsDir, runB);

  // Map stem (no extension) -> actual relative filename (with extension) per side.
  const mapA = new Map(listImagesRecursive(dirA).map(rel => [stem(rel), rel]));
  const mapB = new Map(listImagesRecursive(dirB).map(rel => [stem(rel), rel]));
  const allStems = Array.from(new Set([...mapA.keys(), ...mapB.keys()])).sort();

  const results = allStems.map(key => {
    const relA = mapA.get(key);
    const relB = mapB.get(key);
    if (!relA || !relB) {
      const only = relA || relB;
      return { path: only, pathA: relA, pathB: relB, status: relA ? 'missingB' : 'missingA' };
    }

    // Prefer the "matching" path string when both sides share it, otherwise
    // report both (e.g. one run is .png, the other .webp).
    const displayPath = relA === relB ? relA : `${relA} / ${relB}`;

    let imgA, imgB;
    try {
      imgA = readImage(path.join(dirA, relA));
      imgB = readImage(path.join(dirB, relB));
    } catch (e) {
      return { path: displayPath, pathA: relA, pathB: relB, status: 'error', error: String((e && e.message) || e) };
    }

    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
      return {
        path: displayPath, pathA: relA, pathB: relB, status: 'size-mismatch',
        widthA: imgA.width, heightA: imgA.height,
        widthB: imgB.width, heightB: imgB.height,
      };
    }

    const { width, height } = imgA;
    const diffPixels = pixelmatch(
      imgA.data, imgB.data, null, width, height, { threshold }
    );
    const totalPixels = width * height;
    return {
      path: displayPath,
      pathA: relA,
      pathB: relB,
      status: diffPixels === 0 ? 'match' : 'diff',
      diffPixels,
      totalPixels,
      diffPercent: totalPixels ? (diffPixels / totalPixels) * 100 : 0,
      width, height,
    };
  });

  results.sort((a, b) => (b.diffPercent || 0) - (a.diffPercent || 0));

  const summary = {
    total: results.length,
    match: results.filter(r => r.status === 'match').length,
    diff: results.filter(r => r.status === 'diff').length,
    missingA: results.filter(r => r.status === 'missingA').length,
    missingB: results.filter(r => r.status === 'missingB').length,
    sizeMismatch: results.filter(r => r.status === 'size-mismatch').length,
    error: results.filter(r => r.status === 'error').length,
  };

  return { results, summary };
}

// Build a PNG diff overlay for one (runA, runB, relPath) triple, on demand
// (not cached — used only when a user opens one row's detail view).
// relPathA/relPathB are the actual on-disk relative paths (with extension) for
// each side; when the two runs use the same extension, relPathB === relPathA.
function buildDiffImage(runsDir, runA, runB, relPathA, relPathB, opts = {}) {
  const threshold = opts.threshold ?? 0.1;
  const imgA = readImage(path.join(runsDir, runA, relPathA));
  const imgB = readImage(path.join(runsDir, runB, relPathB ?? relPathA));
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) return null;

  const { width, height } = imgA;
  const diff = new PNG({ width, height });
  pixelmatch(imgA.data, imgB.data, diff.data, width, height, { threshold });
  return PNG.sync.write(diff);
}

module.exports = { listPngsRecursive, listImagesRecursive, listRuns, compareRuns, buildDiffImage };
