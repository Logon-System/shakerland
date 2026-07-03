// State
const state = {
  tests:       [],
  evals:       [],
  archs:       [],
  curTestId:   'A1',
  filter_crtc: 0,
  selArchs:    [],
  imgHeight:   120,
  search:      '',
};

// --- Helpers ------------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// /images/cpc/CPC/A1_CRTC0_A  (sans extension)
function getPath(ev, col) {
  const archPath = col.arch.replace('_', '/');
  const parts = [ev.id, 'CRTC' + col.crtc];
  if (ev.subfolder) parts.push(ev.subfolder);
  parts.push(ev.subTest);
  return `/images/${archPath}/${parts.join('_')}`;
}

// Vrai si ce subtest ouvre un nouveau groupe visuel (séparateur)
function isFirstSubTest(ev) {
  const s = ev.subTest;
  return /[A-Z1]$/.test(s);
}

// Nom affiché dans le séparateur : "R9E7/A" pour {subfolder:"R9E7", subTest:"A1"}
function subtestName(ev) {
  const prefix = ev.subfolder ? ev.subfolder + '/' : '';
  let s = ev.subTest;
  if (/[1-9]$/.test(s)) s = s.slice(0, -1);
  return prefix + s;
}

// "cpc" depuis "cpc_CPC"
function archname(archKey) {
  return archKey.split('_')[0].toUpperCase();
}

// --- Data ---------------------------------------------------------------------

async function loadData() {
  const [archs, tests, evals] = await Promise.all([
    fetch('/api/archs').then(r => r.json()),
    fetch('/api/tests').then(r => r.json()),
    fetch('/api/evals').then(r => r.json()),
  ]);
  state.archs = archs;
  state.tests = tests;
  state.evals = evals;
}

function initFromURL() {
  const p = new URLSearchParams(window.location.search);

  const crtc = p.get('crtc');
  if (crtc !== null) state.filter_crtc = parseInt(crtc);

  const test = p.get('test');
  if (test) state.curTestId = test;

  const fromURL = state.archs.filter(a => p.has(a.id + '_' + a.version));
  state.selArchs = fromURL.length > 0
    ? fromURL.map(a => a.id + '_' + a.version)
    : state.archs
        .filter(a => ['cpc', 'amspirit'].includes(a.id))
        .map(a => a.id + '_' + a.version);
}

function updateURL() {
  const p = new URLSearchParams();
  p.set('crtc', state.filter_crtc);
  p.set('test', state.curTestId);
  state.selArchs.forEach(a => p.set(a, '1'));
  history.replaceState(null, '', '/tests?' + p.toString());
}

// --- Render -------------------------------------------------------------------

function renderTestList() {
  const q = state.search.toLowerCase();
  const rows = state.tests
    .filter(t => !q || t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(t => `<tr data-id="${t.id}" class="${t.id === state.curTestId ? 'selected' : ''}">
      <td><span class="ok"><strong>${escapeHtml(t.id)}</strong></span> ${escapeHtml(t.name)}</td>
    </tr>`)
    .join('');

  document.getElementById('tests-list').innerHTML = rows;

  const sel = document.querySelector('#tests-list tr.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function renderFilters() {
  document.getElementById('crtc-select').innerHTML =
    [0, 1, 2, 3, 4].map(c =>
      `<option value="${c}" ${c === state.filter_crtc ? 'selected' : ''}>CRTC ${c}</option>`
    ).join('');

  document.getElementById('size-select').innerHTML =
    [80, 120, 200, 240, 480, 600, 720].map(s =>
      `<option value="${s}" ${s === state.imgHeight ? 'selected' : ''}>${s}</option>`
    ).join('');

  document.getElementById('arch-checkboxes').innerHTML =
    state.archs.map(a => {
      const key = a.id + '_' + a.version;
      return `<label for="${key}" style="margin-left:0.8em">
        <input type="checkbox" id="${key}" name="selArch"
          ${state.selArchs.includes(key) ? 'checked' : ''}> ${escapeHtml(a.label)}
      </label>`;
    }).join('');
}

function renderTestView() {
  const container = document.getElementById('test-view');
  const test = state.tests.find(t => t.id === state.curTestId);
  if (!test) { container.innerHTML = ''; return; }

  const evList = state.evals
    .filter(e => e.idTest === state.curTestId && e.crtcs.includes(state.filter_crtc))
    .sort((a, b) => {
      const sf = (a.subfolder || '').localeCompare(b.subfolder || '');
      return sf !== 0 ? sf : a.subTest.localeCompare(b.subTest);
    });

  const cols = state.selArchs.map(arch => ({ arch, crtc: state.filter_crtc }));

  let html = `<h1>${escapeHtml(test.id)}: ${escapeHtml(test.name)}</h1>`;

  if (evList.length === 0) {
    html += `<p style="margin-top:1em">No results for CRTC ${state.filter_crtc}</p>`;
    container.innerHTML = html;
    return;
  }

  if (cols.length === 0) {
    html += `<p style="margin-top:1em">Select at least one architecture.</p>`;
    container.innerHTML = html;
    return;
  }

  html += '<table class="pure-table-horizontal"><tbody>';

  for (const ev of evList) {
    if (isFirstSubTest(ev)) {
      html += `<tr class="separation">
        <td colspan="${cols.length}">${escapeHtml(subtestName(ev))}</td>
      </tr>`;
    }
    html += '<tr>';
    for (const col of cols) {
      const path = getPath(ev, col);
      const caption = state.imgHeight > 100
        ? `<figcaption class="centered uppercase">${escapeHtml(archname(col.arch))} CRTC ${col.crtc}</figcaption>`
        : '';
      html += `<td class="centered"><figure>
        <a target="_blank" href="${path}.webp">
          <img class="roundedcorner"
               height="${state.imgHeight}"
               loading="lazy"
               src="${path}.webp"
               alt="${escapeHtml(ev.id)}_CRTC${col.crtc}_${escapeHtml(ev.subTest)}"
               onerror="this.src='/img/notfound.webp';this.onerror=null">
        </a>${caption}
      </figure></td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;
}

function setScrollableHeight() {
  document.querySelectorAll('.scrollable-panel').forEach(el => {
    const top = el.getBoundingClientRect().top + window.scrollY;
    el.style.height = (window.innerHeight - top - 10) + 'px';
  });
}

// --- Events -------------------------------------------------------------------

function bindEvents() {
  document.getElementById('search-input').addEventListener('input', debounce(e => {
    state.search = e.target.value.trim();
    renderTestList();
  }, 300));

  document.getElementById('tests-list').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    state.curTestId = tr.dataset.id;
    updateURL();
    renderTestList();
    renderTestView();
  });

  document.getElementById('crtc-select').addEventListener('change', e => {
    state.filter_crtc = parseInt(e.target.value);
    updateURL();
    renderTestView();
  });

  document.getElementById('size-select').addEventListener('change', e => {
    state.imgHeight = parseInt(e.target.value);
    renderTestView();
  });

  document.getElementById('arch-checkboxes').addEventListener('change', e => {
    if (e.target.name !== 'selArch') return;
    const key = e.target.id;
    if (e.target.checked) {
      if (!state.selArchs.includes(key)) state.selArchs.push(key);
    } else {
      state.selArchs = state.selArchs.filter(a => a !== key);
    }
    updateURL();
    renderTestView();
  });

  window.addEventListener('resize', setScrollableHeight);
}

// --- Init ---------------------------------------------------------------------

async function init() {
  await loadData();
  initFromURL();
  bindEvents();
  renderFilters();
  renderTestList();
  renderTestView();
  setScrollableHeight();
}

init();
