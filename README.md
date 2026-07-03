# Shakerland

CRTC test results viewer for Amstrad CPC emulators vs real hardware.

## Quick Start

### Local Development

```bash
npm install
npm run dev          # Watch mode with auto-reload
# or
npm start            # Single run
```

Server runs on `http://localhost:3000`

### Docker

```bash
docker build -t shakerland .
docker run -p 3000:3000 \
  -e PICTURES_DIR=/images \
  -v /path/to/PictureBank:/images:ro \
  shakerland
```

## Project Structure

- **`public/`** — Frontend HTML, CSS, JS
- **`data/`** — JSON data files (archs, tests, evals)
- **`scripts/`** — Data import and validation tools
- **`server.js`** — Express server with API routes
- **`PictureBank/`** — Screenshot images (external directory)

## API Endpoints

- `GET /api/archs` — List architectures/emulators
- `GET /api/tests` — List tests
- `GET /api/evals` — Evaluation results

## Data Format

### archs.json
```json
{
  "o": 0,
  "id": "cpc",
  "label": "Real Hardware",
  "version": "CPC",
  "desc": "Real Hardware",
  "isEmulator": false
}
```

### tests.json
```json
{
  "module": "A",
  "id": "A1",
  "name": "UPDATE VRAM VS CRTC/GA",
  "desc": "§ 8",
  "crtcs": [0, 1, 2, 3, 4]
}
```

### evals.json
```json
{
  "id": "A1",
  "idTest": "A1",
  "subTest": "A",
  "index": 0,
  "crtcs": [0, 1, 2, 3, 4]
}
```

## Scripts

### import-from-screenshots.js
Maps screenshot images to test results and generates WebP conversion commands.

```bash
node scripts/import-from-screenshots.js \
  --picturedir /path/to/PictureBank \
  --screenshotsdir /path/to/SCREENSHOTS
```

Outputs:
- `screenshots-report.txt` — Import findings per architecture
- `import-screenshots.sh` — Ready-to-run cwebp commands

### find-image-mismatches.js
Compares expected image filenames against actual files, suggests renames using Levenshtein distance.

```bash
node scripts/find-image-mismatches.js --picturedir /path/to/PictureBank
```

### import-from-screenshots.py
Python alternative for screenshot import (same functionality as `.js` version).

## Environment Variables

- `PORT` — Server port (default: 3000)
- `PICTURES_DIR` — Path to image directory (default: `../PictureBank`)

## Requirements

- Node.js 22+
- npm or Docker
