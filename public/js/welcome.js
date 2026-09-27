// Featured emulators list, built from data/archs.json (one line per arch id)

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Groups arch versions by id; label and url come from the lowest-ordered entry
function groupByArch(archs) {
  const groups = new Map();
  archs
    .filter(a => a.isEmulator)
    .sort((a, b) => a.o - b.o)
    .forEach(a => {
      if (!groups.has(a.id)) groups.set(a.id, { label: a.label, url: a.url, versions: [] });
      groups.get(a.id).versions.push(a.version);
    });
  return [...groups.values()];
}

function renderEmulator(arch) {
  const name = arch.url
    ? `<a href="${escapeHtml(arch.url)}">${escapeHtml(arch.label)}</a>`
    : escapeHtml(arch.label);
  const word = arch.versions.length > 1 ? 'versions' : 'version';
  return `<li>${name}, ${word} ${arch.versions.map(escapeHtml).join(', ')}</li>`;
}

async function loadEmulators() {
  const list = document.getElementById('emulator-list');
  try {
    const res = await fetch('/api/archs');
    if (!res.ok) return;
    list.innerHTML = groupByArch(await res.json()).map(renderEmulator).join('');
  } catch (e) {
    // leave the list empty
  }
}

loadEmulators();
