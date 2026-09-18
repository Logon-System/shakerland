// /compare — internal debug tool: pixel-diff two capture runs (RUNS_DIR/<run>)
// produced by scripts/capture-run.sh. Not linked from the main nav.

const state = {
  runs: [],
  groups: {}, // run's first path segment -> its sibling runs
  report: null, // { runA, runB, generatedAt, results, summary }
  selected: null, // result row currently shown in #detail
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A run is grouped by its first path segment (e.g. "amspirit/fork-3d52bad10e7d" -> "amspirit"),
// which is the same emulator/arch across its different captured versions. Comparing two runs
// only makes sense within the same group, so Run A only offers groups with 2+ runs, and Run B
// is limited to the other runs in Run A's group.
function runGroup(run) {
  return run.split('/')[0];
}

function runsByGroup() {
  const groups = {};
  for (const r of state.runs) {
    const g = runGroup(r);
    (groups[g] || (groups[g] = [])).push(r);
  }
  return groups;
}

function optionsHtml(runs, placeholder) {
  const placeholderOpt = placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : '';
  return placeholderOpt + runs.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
}

function populateRunB(runA) {
  const runBSelect = document.getElementById('runB-select');
  if (!runA) {
    runBSelect.innerHTML = optionsHtml([], 'Select Run A first');
    runBSelect.disabled = true;
    return;
  }
  const siblings = state.groups[runGroup(runA)].filter(r => r !== runA);
  runBSelect.innerHTML = optionsHtml(siblings, siblings.length ? null : 'No other version available');
  runBSelect.disabled = siblings.length === 0;
}

async function loadRuns() {
  state.runs = await fetch('/api/runs').then(r => r.json());
  state.groups = runsByGroup();
  const comparableRuns = state.runs.filter(r => state.groups[runGroup(r)].length > 1);

  const runASelect = document.getElementById('runA-select');
  runASelect.innerHTML = optionsHtml(comparableRuns, comparableRuns.length ? 'Select…' : 'No comparable versions');
  runASelect.disabled = comparableRuns.length === 0;

  populateRunB(runASelect.value);
}

// Group results by the first path segment (e.g. "A_CRTC0/A0_1_1.png" -> "A_CRTC0").
function rollup(results) {
  const groups = {};
  for (const r of results) {
    const group = (r.pathA || r.pathB || r.path).split('/')[0];
    if (!groups[group]) groups[group] = { total: 0, match: 0, diff: 0, other: 0, worst: 0 };
    const g = groups[group];
    g.total++;
    if (r.status === 'match') g.match++;
    else if (r.status === 'diff') { g.diff++; g.worst = Math.max(g.worst, r.diffPercent || 0); }
    else g.other++;
  }
  return groups;
}

function renderSummary() {
  const { summary, results, runA, runB } = state.report;
  const groups = rollup(results);
  const groupRows = Object.keys(groups).sort().map(g => {
    const s = groups[g];
    return `<tr><td>${escapeHtml(g)}</td><td>${s.total}</td><td>${s.match}</td>
      <td>${s.diff}</td><td>${s.other}</td><td>${s.worst.toFixed(2)}%</td></tr>`;
  }).join('');

  document.getElementById('summary').innerHTML = `
    <p>
      <span><strong>${escapeHtml(runA)}</strong> vs <strong>${escapeHtml(runB)}</strong></span>
      <span>total: ${summary.total}</span>
      <span>identical: ${summary.match}</span>
      <span>different: ${summary.diff}</span>
      <span>missing in A: ${summary.missingA}</span>
      <span>missing in B: ${summary.missingB}</span>
      <span>size mismatch: ${summary.sizeMismatch}</span>
      <span>errors: ${summary.error}</span>
    </p>
    <table class="pure-table pure-table-horizontal">
      <thead><tr><th>Group</th><th>Total</th><th>Identical</th><th>Diff</th><th>Other</th><th>Worst %</th></tr></thead>
      <tbody>${groupRows}</tbody>
    </table>
  `;
}

function statusLabel(r) {
  switch (r.status) {
    case 'match': return 'identical';
    case 'diff': return `${r.diffPixels} / ${r.totalPixels} px`;
    case 'missingA': return 'missing in A';
    case 'missingB': return 'missing in B';
    case 'size-mismatch': return `size mismatch (${r.widthA}x${r.heightA} vs ${r.widthB}x${r.heightB})`;
    case 'error': return `error: ${r.error}`;
    default: return r.status;
  }
}

function renderTable() {
  const rows = state.report.results.map((r, i) => {
    const cls = r.status === 'diff' ? 'row-diff' : r.status === 'match' ? 'row-match' : '';
    const pct = r.status === 'diff' ? `${r.diffPercent.toFixed(3)}%` : '—';
    return `<tr data-i="${i}" class="${cls}">
      <td>${escapeHtml(r.path)}</td>
      <td class="pct">${pct}</td>
      <td>${escapeHtml(statusLabel(r))}</td>
    </tr>`;
  }).join('');

  document.getElementById('table-container').innerHTML = `
    <table class="pure-table pure-table-horizontal compare-table">
      <thead><tr><th>Path</th><th>% diff</th><th>Detail</th></tr></thead>
      <tbody id="compare-rows">${rows}</tbody>
    </table>
  `;

  document.getElementById('compare-rows').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    document.querySelectorAll('#compare-rows tr.selected').forEach(x => x.classList.remove('selected'));
    tr.classList.add('selected');
    showDetail(state.report.results[parseInt(tr.dataset.i, 10)]);
  });
}

function showDetail(r) {
  state.selected = r;
  const { runA, runB } = state.report;
  const el = document.getElementById('detail');
  if (r.status !== 'diff' && r.status !== 'match') {
    el.innerHTML = `<h3>${escapeHtml(r.path)}</h3><p>${escapeHtml(statusLabel(r))}</p>`;
    return;
  }
  const relA = r.pathA || r.path;
  const relB = r.pathB || r.path;
  const urlA = `/runs/${encodeURIComponent(runA)}/${relA.split('/').map(encodeURIComponent).join('/')}`;
  const urlB = `/runs/${encodeURIComponent(runB)}/${relB.split('/').map(encodeURIComponent).join('/')}`;
  const diffUrl = `/api/compare/diff-image?runA=${encodeURIComponent(runA)}&runB=${encodeURIComponent(runB)}` +
    `&path=${encodeURIComponent(relA)}&pathB=${encodeURIComponent(relB)}`;

  el.innerHTML = `
    <h3>${escapeHtml(r.path)} — ${escapeHtml(statusLabel(r))}</h3>
    <div class="shots">
      <figure><img src="${urlA}" alt="A"><figcaption>${escapeHtml(runA)}</figcaption></figure>
      <figure><img src="${urlB}" alt="B"><figcaption>${escapeHtml(runB)}</figcaption></figure>
      ${r.status === 'diff' ? `<figure><img src="${diffUrl}" alt="diff"><figcaption>diff overlay</figcaption></figure>` : ''}
    </div>
  `;
}

async function runCompare(refresh) {
  const runA = document.getElementById('runA-select').value;
  const runB = document.getElementById('runB-select').value;
  if (!runA || !runB) return;
  document.getElementById('summary').innerHTML = '<p>Comparing…</p>';
  document.getElementById('table-container').innerHTML = '';
  document.getElementById('detail').innerHTML = '';

  const qs = new URLSearchParams({ runA, runB });
  if (refresh) qs.set('refresh', '1');
  const res = await fetch('/api/compare?' + qs.toString());
  const body = await res.json();
  if (!res.ok) {
    document.getElementById('summary').innerHTML = `<p>Error: ${escapeHtml(body.error || res.statusText)}</p>`;
    return;
  }
  state.report = body;
  renderSummary();
  renderTable();
}

function bindEvents() {
  document.getElementById('compare-btn').addEventListener('click', () => runCompare(false));
  document.getElementById('refresh-btn').addEventListener('click', () => runCompare(true));
  document.getElementById('runA-select').addEventListener('change', e => populateRunB(e.target.value));
}

async function init() {
  await loadRuns();
  bindEvents();
}

init();
