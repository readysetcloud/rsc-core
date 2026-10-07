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
