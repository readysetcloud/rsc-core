/*
 * Diagram animation for the agent guide. Two modes, declared on the figure:
 *   data-anim="sequence"  steps appear one by one, then everything stays (Replay)
 *   data-anim="cycle"     one step at a time is highlighted, looping (Pause/Play),
 *                         with the matching legend item highlighted alongside
 * Without JavaScript, or with prefers-reduced-motion, every step is simply shown.
 */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

for (const fig of document.querySelectorAll('.ag-figure[data-anim]')) {
  const mode = fig.dataset.anim;
  const els = [...fig.querySelectorAll('[data-step]')];
  const steps = [...new Set(els.map(el => Number(el.dataset.step)))].sort((a, b) => a - b);
  const button = fig.querySelector('[data-anim-toggle]');
  const interval = mode === 'sequence' ? 850 : 2200;
  let timer = null;
  let index = 0;
  let userPaused = false;
  let started = false;

  const show = step => {
    for (const el of els) {
      const n = Number(el.dataset.step);
      el.classList.toggle('is-on', mode === 'sequence' ? n <= step : n === step);
    }
  };

  const label = () => {
    button.textContent = mode === 'sequence' ? 'Replay' : timer ? 'Pause' : 'Play';
  };

  const stop = () => {
    clearInterval(timer);
    timer = null;
    fig.classList.remove('is-animating');
    for (const el of els) el.classList.remove('is-on');
    label();
  };

  const play = () => {
    if (reduceMotion.matches || steps.length === 0) return;
    clearInterval(timer);
    started = true;
    index = 0;
    fig.classList.add('is-animating');
    show(steps[0]);
    timer = setInterval(() => {
      index += 1;
      if (index >= steps.length) {
        if (mode === 'sequence') return stop();
        index = 0;
      }
      show(steps[index]);
    }, interval);
    label();
  };

  if (reduceMotion.matches || !button) continue;
  button.hidden = false;
  label();
  button.addEventListener('click', () => {
    if (mode === 'cycle' && timer) {
      userPaused = true;
      stop();
    } else {
      userPaused = false;
      play();
    }
  });

  new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        if (mode === 'sequence' ? !started : !timer && !userPaused) play();
      } else if (mode === 'cycle' && timer) {
        stop();
      }
    }
  }, { threshold: 0.35 }).observe(fig);
}

/*
 * "Which agent do you need?" picker on the overview. Each option either
 * reveals the next question (data-next) or shows a result (data-result).
 * Without JavaScript the questions stay hidden and every result is listed.
 */
for (const picker of document.querySelectorAll('[data-picker]')) {
  const questions = [...picker.querySelectorAll('.ag-picker-q')];
  const results = [...picker.querySelectorAll('.ag-picker-result')];
  const reset = picker.querySelector('[data-picker-reset]');
  picker.classList.add('is-live');

  const showResult = name => {
    for (const r of results) r.classList.toggle('is-match', r.dataset.result === name);
    reset.hidden = !name;
  };

  const restart = () => {
    questions.forEach((q, i) => {
      q.hidden = i !== 0;
      q.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
    });
    showResult(null);
  };

  for (const q of questions) {
    for (const opt of q.querySelectorAll('.ag-picker-opt')) {
      opt.setAttribute('aria-pressed', 'false');
      opt.addEventListener('click', () => {
        q.querySelectorAll('.ag-picker-opt').forEach(b => b.setAttribute('aria-pressed', String(b === opt)));
        // Anything after this question belongs to an earlier answer: hide it.
        const after = questions.slice(questions.indexOf(q) + 1);
        after.forEach(later => {
          later.hidden = true;
          later.querySelectorAll('.ag-picker-opt').forEach(b => b.setAttribute('aria-pressed', 'false'));
        });
        if (opt.dataset.next) {
          showResult(null);
          reset.hidden = false;
          const next = picker.querySelector(`[data-q="${opt.dataset.next}"]`);
          next.hidden = false;
          next.querySelector('.ag-picker-opt').focus({ preventScroll: true });
        } else {
          showResult(opt.dataset.result);
        }
      });
    }
  }
  reset.addEventListener('click', restart);
  restart();
}

/* Side table of contents: highlight the section being read. */
const tocLinks = [...document.querySelectorAll('.ag-toc a')];
if (tocLinks.length && 'IntersectionObserver' in window) {
  const byId = new Map(tocLinks.map(a => [a.hash.slice(1), a]));
  const visible = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const e of entries) e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id);
    const current = [...byId.keys()].find(id => visible.has(id));
    if (current) tocLinks.forEach(a => a.classList.toggle('is-active', a === byId.get(current)));
  }, { rootMargin: '0px 0px -60% 0px' });
  for (const id of byId.keys()) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
}

/* Reference: filter every table row by a search term. */
const filterInput = document.querySelector('[data-filter-input]');
if (filterInput) {
  const sections = [...document.querySelectorAll('[data-filter-section]')];
  const empty = document.querySelector('[data-filter-empty]');
  filterInput.addEventListener('input', () => {
    const term = filterInput.value.trim().toLowerCase();
    let any = false;
    for (const section of sections) {
      const rows = [...section.querySelectorAll('tbody tr')];
      let shown = 0;
      for (const row of rows) {
        const match = !term || row.textContent.toLowerCase().includes(term);
        row.hidden = !match;
        if (match) shown += 1;
      }
      section.hidden = term !== '' && shown === 0;
      if (!section.hidden) any = true;
    }
    empty.hidden = any;
  });
}
