/*
 * Guide behavior. Brand values are never hardcoded here — swatches and
 * specimens read the live custom properties from the ui package stylesheet,
 * so the guide re-renders itself whenever the tokens change.
 */

/* ---------- theme toggle (matches the data-theme contract) ---------- */

const THEME_KEY = 'rsc-ds-theme';

function applyTheme(theme) {
  if (theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }
  renderSwatches();
}

function currentTheme() {
  const explicit = document.documentElement.dataset.theme;
  if (explicit) return explicit;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
  btn.addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderSwatches());

/* ---------- mobile nav ---------- */

const menuBtn = document.querySelector('.app-nav-menu-btn');
if (menuBtn) {
  menuBtn.addEventListener('click', () => {
    document.querySelector('.app-nav-collapse')?.classList.toggle('app-nav-collapse-open');
  });
}

/* ---------- token swatches (read live from the stylesheet) ---------- */

const RAMP_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

function readToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function tripletToHex(triplet) {
  const parts = triplet.split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return triplet;
  return `#${parts.map(n => n.toString(16).padStart(2, '0')).join('')}`;
}

function swatchButton(varName, chipStyle, title, subtitle) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'swatch';
  btn.title = `Copy rgb(var(${varName}))`;

  const chip = document.createElement('span');
  chip.className = 'swatch-chip';
  chip.style.background = chipStyle;

  const copy = document.createElement('span');
  copy.className = 'swatch-copy';
  copy.innerHTML = `<strong>${title}</strong>${subtitle}`;

  btn.append(chip, copy);
  btn.addEventListener('click', () => {
    navigator.clipboard?.writeText(`rgb(var(${varName}))`);
    const original = copy.innerHTML;
    copy.innerHTML = `<strong>${title}</strong>copied!`;
    setTimeout(() => { copy.innerHTML = original; }, 900);
  });
  return btn;
}

function renderSwatches() {
  for (const rampEl of document.querySelectorAll('[data-ramp]')) {
    const ramp = rampEl.dataset.ramp;
    rampEl.textContent = '';
    for (const step of RAMP_STEPS) {
      const varName = `--${ramp}-${step}`;
      const value = readToken(varName);
      if (!value) continue;
      rampEl.append(swatchButton(varName, `rgb(${value})`, step, tripletToHex(value)));
    }
  }

  for (const groundEl of document.querySelectorAll('[data-ground-tokens]')) {
    groundEl.textContent = '';
    for (const name of ['background', 'surface', 'foreground', 'muted', 'muted-foreground', 'border', 'ring']) {
      const varName = `--${name}`;
      const value = readToken(varName);
      if (!value) continue;
      groundEl.append(swatchButton(varName, `rgb(${value})`, `--${name}`, tripletToHex(value)));
    }
  }
}

renderSwatches();

/* ---------- sparklines (window.rscUi from the ui package browser bundle) ---------- */

function drawSparklines() {
  if (!window.rscUi) return;
  for (const el of document.querySelectorAll('[data-sparkline]')) {
    try {
      window.rscUi.renderSparkline(el, JSON.parse(el.dataset.sparkline));
    } catch { /* malformed demo data — leave the element empty */ }
  }
}

drawSparklines();

/* ---------- interactive demos ---------- */

// Segmented control demos: clicking moves aria-pressed.
for (const group of document.querySelectorAll('.demo .segmented-control')) {
  group.addEventListener('click', event => {
    const btn = event.target.closest('.segmented-control-option');
    if (!btn || btn.disabled) return;
    for (const option of group.querySelectorAll('.segmented-control-option')) {
      option.setAttribute('aria-pressed', String(option === btn));
    }
  });
}

// Modal demo.
for (const opener of document.querySelectorAll('[data-open-modal]')) {
  opener.addEventListener('click', () => {
    document.getElementById(opener.dataset.openModal)?.showModal();
  });
}

/* ---------- code tabs + copy ---------- */

for (const block of document.querySelectorAll('.demo-code')) {
  const panes = [...block.querySelectorAll('pre[data-lang]')];
  const bar = document.createElement('div');
  bar.className = 'demo-code-tabs';

  if (panes.length > 1) {
    const tabs = document.createElement('div');
    tabs.className = 'segmented-control';
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Code language');
    panes.forEach((pane, index) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'segmented-control-option';
      tab.textContent = pane.dataset.lang;
      tab.setAttribute('aria-pressed', String(index === 0));
      pane.hidden = index !== 0;
      tab.addEventListener('click', () => {
        panes.forEach(p => { p.hidden = p !== pane; });
        tabs.querySelectorAll('.segmented-control-option').forEach(t => {
          t.setAttribute('aria-pressed', String(t === tab));
        });
      });
      tabs.append(tab);
    });
    bar.append(tabs);
  } else {
    bar.append(document.createElement('span'));
  }

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'ds-copy';
  copy.textContent = 'copy';
  copy.addEventListener('click', () => {
    const visible = panes.find(p => !p.hidden) ?? panes[0];
    navigator.clipboard?.writeText(visible.textContent.trim());
    copy.textContent = 'copied!';
    setTimeout(() => { copy.textContent = 'copy'; }, 900);
  });
  bar.append(copy);

  block.prepend(bar);
}
