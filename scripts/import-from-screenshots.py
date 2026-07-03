#!/usr/bin/env python3
"""
Maps SCREENSHOTS source files to missing webp targets in PictureBank.

Strategy:
  1. Scan every SCREENSHOTS/{EMU}/{22X TEST Y}/CRTC {N}/[subfolder/]{subTest}.ext
  2. Compute the "natural" expected webp name from the path
  3. If that webp already exists in PictureBank → skip (already imported)
  4. If it's missing → look for the closest subtest name in evals.json that is
     also missing from PictureBank, for the same (archId, testId, crtc, subfolder)
  5. Output a cwebp conversion command for confirmed matches

Two match types:
  EXACT  : SCREENSHOTS subtest == evals.json subtest (guaranteed correct)
  FUZZY  : Levenshtein(source_subtest, eval_subtest) ≤ MAX_DIST
            → commented out in the shell script, listed separately in report

Usage:
  python3 scripts/import-from-screenshots.py [--picturedir PATH] [--screenshotsdir PATH]
Output:
  screenshots-report.txt   : findings per arch
  import-screenshots.sh    : cwebp commands (fuzzy matches commented out)
"""

import os, re, json, sys

# ── Config ────────────────────────────────────────────────────────────────────

SCRIPT_DIR     = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR    = os.path.dirname(SCRIPT_DIR)
DATA_DIR       = os.path.join(PROJECT_DIR, 'data')

argv = sys.argv[1:]
def flag(name):
    try: return argv[argv.index(name) + 1]
    except (ValueError, IndexError): return None

PICTURE_DIR     = flag('--picturedir')     or os.path.normpath(os.path.join(PROJECT_DIR, '../PictureBank'))
SCREENSHOTS_DIR = flag('--screenshotsdir') or os.path.normpath(os.path.join(PROJECT_DIR, '../SCREENSHOTS'))

ARCH_MAP = {          # SCREENSHOTS folder name → (archId, version)
    'AMSPIRIT': ('amspirit', '0.953'),
    'ACE':      ('ace',      '1.22'),
    'WINAPE':   ('winape',   '2.0b3'),
    'CPCEC':    ('cpcec',    '20220806'),
}

IMG_EXTS = {'.bmp', '.png', '.jpg', '.jpeg'}
MAX_DIST = 2          # max Levenshtein distance for fuzzy subtest matching

def make_convert_cmd(src, dest):
    """Use ImageMagick convert for BMP (cwebp can't handle 32-bit BMP), cwebp for others."""
    if src.lower().endswith('.bmp'):
        return f'convert -quality 90 "{src}" "{dest}"'
    return f'cwebp -q 90 "{src}" -o "{dest}"'

# ── Levenshtein ───────────────────────────────────────────────────────────────

def levenshtein(a, b):
    m, n = len(a), len(b)
    dp = [[0]*(n+1) for _ in range(m+1)]
    for i in range(m+1): dp[i][0] = i
    for j in range(n+1): dp[0][j] = j
    for i in range(1, m+1):
        for j in range(1, n+1):
            dp[i][j] = dp[i-1][j-1] if a[i-1]==b[j-1] \
                       else 1 + min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
    return dp[m][n]

# ── Load evals ────────────────────────────────────────────────────────────────

with open(os.path.join(DATA_DIR, 'evals.json')) as f:
    evals = json.load(f)

# Build lookup: (testId, crtc, subfolder) → sorted list of expected subTests
from collections import defaultdict
eval_subtests = defaultdict(list)  # key → [(subTest, webpName)]
for ev in evals:
    sf = ev.get('subfolder', '')
    for crtc in ev['crtcs']:
        parts = [ev['id'], 'CRTC'+str(crtc)]
        if sf: parts.append(sf)
        parts.append(ev['subTest'])
        webp = '_'.join(parts) + '.webp'
        eval_subtests[(ev['id'], crtc, sf)].append((ev['subTest'], webp))

# ── Test folder → testId ─────────────────────────────────────────────────────

TEST_RE = re.compile(r'^22([A-D]) TEST (.+)$', re.IGNORECASE)

def folder_to_testid(name):
    m = TEST_RE.match(name)
    if not m: return None
    series = m.group(1).upper()
    key = re.sub(r'\s*\([^)]*\)', '', m.group(2)).strip()
    return series + key

# ── Main scan ─────────────────────────────────────────────────────────────────

report_lines = []
convert_lines = [
    '#!/bin/bash',
    '# Auto-generated from SCREENSHOTS — REVIEW BEFORE EXECUTING',
    '# EXACT matches: run as-is.  FUZZY matches: commented out, verify manually.',
    '# Uses cwebp -q 90.',
    '',
]

total_exact = total_fuzzy = total_skip_exists = total_no_match = 0

for emu_folder, (arch_id, version) in sorted(ARCH_MAP.items()):
    emu_path = os.path.join(SCREENSHOTS_DIR, emu_folder)
    pb_dir   = os.path.join(PICTURE_DIR, arch_id, version)
    if not os.path.isdir(emu_path):
        continue

    counters = {'exact': 0, 'fuzzy': 0, 'skip': 0, 'no_match': 0}

    report_lines.append('')
    report_lines.append('═'*72)
    report_lines.append(f'ARCH: {arch_id}/{version}')
    report_lines.append('═'*72)
    convert_lines.append(f'\n# ── {arch_id}/{version} {"─"*(55-len(arch_id)-len(version))}')
    convert_lines.append(f'mkdir -p "{pb_dir}"')

    def process_file(fpath, test_id_s, crtc_num_s, subfolder, fname):
        ext = os.path.splitext(fname)[1].lower()
        if ext not in IMG_EXTS:
            return
        src_subtest = os.path.splitext(fname)[0]

        parts = [test_id_s, 'CRTC'+str(crtc_num_s)]
        if subfolder: parts.append(subfolder)
        parts.append(src_subtest)
        natural_webp = '_'.join(parts) + '.webp'
        dest_path = os.path.join(pb_dir, natural_webp)

        if os.path.exists(dest_path):
            counters['skip'] += 1
            return

        key = (test_id_s, crtc_num_s, subfolder)
        candidates = eval_subtests.get(key, [])

        if src_subtest in [st for st, _ in candidates]:
            counters['exact'] += 1
            report_lines.append(f'  EXACT  {natural_webp}')
            report_lines.append(f'         <- {os.path.relpath(fpath, SCREENSHOTS_DIR)}')
            report_lines.append('')
            convert_lines.append(make_convert_cmd(fpath, dest_path))
            return

        best_st, best_webp, best_dist = None, None, MAX_DIST + 1
        src_up = src_subtest.upper()
        for st, webp in candidates:
            if os.path.exists(os.path.join(pb_dir, webp)):
                continue
            st_up = st.upper()
            # Only allow fuzzy if one is a prefix of the other
            if not (st_up.startswith(src_up) or src_up.startswith(st_up)):
                continue
            dist = levenshtein(src_up, st_up)
            if dist < best_dist:
                best_dist = dist
                best_st   = st
                best_webp = webp

        if best_st is not None:
            counters['fuzzy'] += 1
            report_lines.append(f'  FUZZY  {best_webp}  [src="{src_subtest}"→"{best_st}" dist={best_dist}]')
            report_lines.append(f'         <- {os.path.relpath(fpath, SCREENSHOTS_DIR)}')
            report_lines.append('')
            cmd = make_convert_cmd(fpath, os.path.join(pb_dir, best_webp))
            convert_lines.append(f'# FUZZY dist={best_dist}: {cmd}')
        else:
            counters['no_match'] += 1
            any_key = any(k[0] == test_id_s for k in eval_subtests)
            if any_key:
                report_lines.append(f'  NOMATCH {natural_webp}  (not in evals.json for this arch/crtc)')
                report_lines.append('')

    def scan_dir(d, test_id_s, crtc_num_s, subfolder=''):
        for fname in sorted(os.listdir(d)):
            fpath = os.path.join(d, fname)
            if os.path.isdir(fpath):
                if not fname.startswith('_'):
                    scan_dir(fpath, test_id_s, crtc_num_s, fname)
            else:
                process_file(fpath, test_id_s, crtc_num_s, subfolder, fname)

    for test_folder in sorted(os.listdir(emu_path)):
        test_id = folder_to_testid(test_folder)
        if not test_id:
            continue
        test_path = os.path.join(emu_path, test_folder)

        for crtc_dir in sorted(os.listdir(test_path)):
            if not crtc_dir.startswith('CRTC '):
                continue
            crtc_num = int(crtc_dir.split(' ')[1])
            crtc_path = os.path.join(test_path, crtc_dir)
            scan_dir(crtc_path, test_id, crtc_num)

    total_exact        += counters['exact']
    total_fuzzy        += counters['fuzzy']
    total_skip_exists  += counters['skip']
    total_no_match     += counters['no_match']
    report_lines.append(f'  → exact={counters["exact"]}  fuzzy={counters["fuzzy"]}  skip={counters["skip"]}  no_match={counters["no_match"]}')

# ── Header ────────────────────────────────────────────────────────────────────

from datetime import datetime
header = [
    f'SCREENSHOTS import report — {datetime.now().isoformat()}',
    f'PictureBank:  {PICTURE_DIR}',
    f'Screenshots:  {SCREENSHOTS_DIR}',
    f'EXACT (safe):  {total_exact}  |  FUZZY (review): {total_fuzzy}  |  already exist: {total_skip_exists}  |  no match: {total_no_match}',
    '',
]
report_lines = header + report_lines

# ── Write output ──────────────────────────────────────────────────────────────

report_path  = os.path.join(PROJECT_DIR, 'screenshots-report.txt')
convert_path = os.path.join(PROJECT_DIR, 'import-screenshots.sh')

with open(report_path,  'w') as f: f.write('\n'.join(report_lines) + '\n')
with open(convert_path, 'w') as f: f.write('\n'.join(convert_lines) + '\n')
os.chmod(convert_path, 0o755)

print(f'Report  : {report_path}')
print(f'Convert : {convert_path}')
print(f'Total   : {total_exact} exact | {total_fuzzy} fuzzy | {total_skip_exists} already exist | {total_no_match} no match')
