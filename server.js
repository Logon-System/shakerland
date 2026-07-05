const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// Images (non versionnées, hors repo git)
const PICTURES_DIR = process.env.PICTURES_DIR ||
  path.join(__dirname, '../PictureBank');

// Fichiers statiques de l'app (CSS, JS, images UI)
app.use(express.static(path.join(__dirname, 'public')));

// Banque d'images émulateurs
app.use('/images', express.static(PICTURES_DIR));

// API JSON
app.get('/api/archs', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'archs.json'));
});

app.get('/api/tests', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'tests.json'));
});

// Routes
const page = (f) => (req, res) => res.sendFile(path.join(__dirname, 'public', f));
app.get(['/', '/welcome'],        page('welcome.html'));
app.get(['/tests', '/results'],   page('results.html'));
app.get('/ssmcsl',                page('ssmcsl.html'));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'welcome.html')));

app.listen(PORT, () => {
  console.log(`Shakerland running on http://localhost:${PORT}`);
  console.log(`Images served from: ${PICTURES_DIR}`);
});
