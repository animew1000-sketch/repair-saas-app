/* Motivo v4: noticeably moving top/middle/bottom gradients on scroll.
 * Only paints CSS variables (no data, DOM markup, auth or API interception).
 * Scroll listeners are passive, updates are throttled to animation frames.
 */
(function motivoScrollGradient(root) {
  'use strict';
  if (!root || !root.document || root.__motivoScrollGradientStarted) return;
  root.__motivoScrollGradientStarted = true;

  const doc = root.document;
  const html = doc.documentElement;
  const reduce = typeof root.matchMedia === 'function'
    ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const properties = [
    '--motivo-glow-top-x', '--motivo-glow-mid-x', '--motivo-glow-bottom-x',
    '--motivo-glow-top-y', '--motivo-glow-mid-y', '--motivo-glow-bottom-alpha'
  ];
  let pending = false;

  function reset() { properties.forEach(name => html.style.removeProperty(name)); }

  function paint() {
    pending = false;
    if (reduce && reduce.matches) { reset(); return; }
    const el = doc.scrollingElement || html;
    const viewport = Math.max(1, root.innerHeight || html.clientHeight || 1);
    const totalHeight = Math.max(el.scrollHeight || 0, html.scrollHeight || 0);
    const maxScroll = Math.max(0, totalHeight - viewport);
    const y = clamp(el.scrollTop || root.scrollY || 0, 0, maxScroll);
    const progress = maxScroll ? y / maxScroll : 0;
    const proximity = clamp(1 - (maxScroll - y) / Math.max(650, viewport * 2), 0, 1);

    // Intentionally obvious but slow-moving: 140-230px of movement over
    // a typical scroll, with independent curves for the three glows.
    const topX = Math.sin(y / 285 + .20) * 155 + progress * 55;
    const midX = Math.cos(y / 355 + 1.35) * 175;
    const bottomX = Math.sin(y / 260 + .75) * 225;
    const topY = Math.sin(y / 370) * 65;
    const midY = Math.cos(y / 495 + .4) * 55;
    const alpha = .26 + .30 * proximity;

    html.style.setProperty('--motivo-glow-top-x', `${topX.toFixed(1)}px`);
    html.style.setProperty('--motivo-glow-mid-x', `${midX.toFixed(1)}px`);
    html.style.setProperty('--motivo-glow-bottom-x', `${bottomX.toFixed(1)}px`);
    html.style.setProperty('--motivo-glow-top-y', `${topY.toFixed(1)}px`);
    html.style.setProperty('--motivo-glow-mid-y', `${midY.toFixed(1)}px`);
    html.style.setProperty('--motivo-glow-bottom-alpha', alpha.toFixed(3));
  }

  function schedule() {
    if (pending) return;
    pending = true;
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(paint);
    else paint();
  }

  if (reduce) {
    const onChange = () => { if (reduce.matches) reset(); else schedule(); };
    if (typeof reduce.addEventListener === 'function') reduce.addEventListener('change', onChange);
    else if (typeof reduce.addListener === 'function') reduce.addListener(onChange);
  }
  root.addEventListener('scroll', schedule, {passive: true});
  root.addEventListener('resize', schedule, {passive: true});
  root.addEventListener('pageshow', schedule);
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', schedule, {once: true});
  schedule();
})(typeof window !== 'undefined' ? window : null);
