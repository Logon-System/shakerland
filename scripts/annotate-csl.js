#!/usr/bin/env node
/**
 * Turns a shaker CSL script (public/Shaker_CSL/MODULE_X/SHAKE26X-N.CSL) into a
 * capture-ready copy that stops after its own CRTC instead of chaining into
 * the next one.
 *
 * Screenshots themselves need NO changes to the script: the shaker program
 * on the DSK emits its own SSM `ED xx ED yy` opcode pairs as each test screen
 * is ready (see `ssm_process` in amspirit-lite's ssm_handler.cpp), which the
 * emulator (run with --ssm) automatically saves as
 * "AMSPIRIT_<crtc>_<4-hex-digit code>.png" in the process's cwd — the exact
 * naming `scripts/rename_pictures_shaker_code/rename_shaker.sh` expects, and
 * the same 4-hex-digit codes already listed per subtest in
 * shakerland/data/tests.json ("hex" field) / shaker_code_to_test_id.csv.
 * (An earlier version of this script invented its own screenshot naming from
 * key_output/wait heuristics — wrong, since it didn't match either the SSM
 * codes or rename_shaker.sh's expected input; removed.)
 *
 * The only thing this script still needs to do: each module's
 * SHAKE26X-N.CSL ends with `csl_load '<next>'`, chaining to the next CRTC of
 * the same module (order 0→1→2→4→3 for module A) — a human running "one
 * module" normally sweeps all 5 CRTCs in one continuous session. This
 * pipeline captures one module × one CRTC at a time (explicit user request:
 * running full chains produces far too many captures per invocation), so the
 * csl_load line is commented out.
 *
 * Usage:
 *   node scripts/annotate-csl.js --in public/Shaker_CSL/MODULE_A/SHAKE26A-0.CSL \
 *     --out public/Shaker_CSL_capture/MODULE_A/SHAKE26A-0.CSL
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
function flag(name, def) {
  const i = argv.indexOf('--' + name);
  return i !== -1 ? argv[i + 1] : def;
}

const inPath  = flag('in');
const outPath = flag('out');

if (!inPath || !outPath) {
  console.error('Usage: annotate-csl.js --in FILE.CSL --out FILE.CSL');
  process.exit(1);
}

const CSL_LOAD_RE = /^\s*c[sl]l_load\b/; // typo variant "cls_load" seen once in this corpus

const lines = fs.readFileSync(inPath, 'utf8').split(/\r?\n/);
const out = lines.map(line =>
  CSL_LOAD_RE.test(line)
    ? `-- ${line} -- disabled by annotate-csl.js: one module x CRTC per capture run`
    : line
);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out.join('\n') + '\n');
console.log(`Wrote ${outPath}`);
