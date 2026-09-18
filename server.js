const express = require('express');
const path    = require('path');
const fs      = require('fs');

const { listRuns, compareRuns, buildDiffImage } = require('./lib/pixel-diff');

const app  = express();
const PORT = process.env.PORT || 3000;

// Images (non versionnées, hors repo git)
const PICTURES_DIR = process.env.PICTURES_DIR ||
  path.join(__dirname, '../PictureBank');

// Core-build capture runs compared by /compare (internal debug feature, not in
// the nav) — produced by scripts/capture-run.sh. Worth keeping, so this is the
// same PictureBank directory as PICTURES_DIR by default: a run is normally
// PictureBank/<archId>/<version>/ (see lib/pixel-diff.js's listRuns).
const RUNS_DIR = process.env.RUNS_DIR || PICTURES_DIR;

const COMPARE_CACHE_DIR = path.join(__dirname, 'data', 'compare-cache');

// Fichiers statiques de l'app (CSS, JS, images UI)
app.use(express.static(path.join(__dirname, 'public')));

// Banque d'images émulateurs
app.use('/images', express.static(PICTURES_DIR));

// Captures brutes des runs core (pour les vignettes du comparateur)
app.use('/runs', express.static(RUNS_DIR));

// API JSON
app.get('/api/archs', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'archs.json'));
});

app.get('/api/tests', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'tests.json'));
});

// --- Pixel-diff compare (internal debug tool) --------------------------------

app.get('/api/runs', (req, res) => {
  res.json(listRuns(RUNS_DIR));
});

app.get('/api/compare', (req, res) => {
  const { runA, runB } = req.query;
  if (!runA || !runB) {
    return res.status(400).json({ error: 'runA and runB query params are required' });
  }

  const sanitize = (s) => s.replace(/\//g, '_');
  const cachePath = path.join(COMPARE_CACHE_DIR, `${sanitize(runA)}__vs__${sanitize(runB)}.json`);
  if (req.query.refresh !== '1' && fs.existsSync(cachePath)) {
    return res.sendFile(cachePath);
  }

  let report;
  try {
    report = compareRuns(RUNS_DIR, runA, runB);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }

  const body = { runA, runB, generatedAt: new Date().toISOString(), ...report };
  fs.mkdirSync(COMPARE_CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(body));
  res.json(body);
});

app.get('/api/compare/diff-image', (req, res) => {
  const { runA, runB, path: relPath, pathB: relPathB } = req.query;
  if (!runA || !runB || !relPath) {
    return res.status(400).json({ error: 'runA, runB and path query params are required' });
  }
  let png;
  try {
    png = buildDiffImage(RUNS_DIR, runA, runB, relPath, relPathB);
  } catch (e) {
    return res.status(404).json({ error: String((e && e.message) || e) });
  }
  if (!png) return res.status(422).json({ error: 'images differ in size, cannot diff' });
  res.set('Content-Type', 'image/png');
  res.send(png);
});

// Routes
const page = (f) => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get(['/', '/welcome'],        page('welcome.html'));
app.get(['/tests', '/results'],   page('results.html'));
app.get('/ssmcsl',                page('ssmcsl.html'));
app.get('/compare',               page('compare.html')); // internal debug tool, not in the nav
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'welcome.html')));

app.listen(PORT, () => {
  console.log(`Shakerland running on http://localhost:${PORT}`);
  console.log(`Images served from: ${PICTURES_DIR}`);
});
