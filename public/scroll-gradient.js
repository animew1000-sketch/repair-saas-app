/* Motivo v3: subtle scroll-driven movement for the existing edge gradients.
 * Visual enhancement only: does not inspect forms, user records, or navigation.
 * Works without third-party dependencies and respects prefers-reduced-motion.
 */
(function motivoScrollGradient(root) {
  'use strict';
  if (!root || !root.document || root.__motivoScrollGradientStarted) return;
  root.__motivoScrollGradientStarted = true;

  const doc = root.document;
  const element = doc.documentElement;
  const reducedMotion = typeof root.matchMedia === 'function'
    ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  let framePending = false;

  function resetMotion() {
    element.style.removeProperty('--motivo-glow-top-x');
    element.style.removeProperty('--motivo-glow-bottom-x');
    element.style.removeProperty('--motivo-glow-bottom-alpha');
  }

  function paint() {
    framePending = false;
    if (reducedMotion && reducedMotion.matches) {
      resetMotion();
      return;
    }

    const scrollElement = doc.scrollingElement || element;
    const viewportHeight = root.innerHeight || element.clientHeight || 1;
    const height = Math.max(scrollElement.scrollHeight || 0, element.scrollHeight || 0);
    const maxScroll = Math.max(0, height - viewportHeight);
    const scrollTop = clamp(scrollElement.scrollTop || root.scrollY || 0, 0, maxScroll);
    const progress = maxScroll ? scrollTop / maxScroll : 0;

    // The upper glow drifts quietly while users leave the top of the page.
    const topDrift = Math.sin(progress * Math.PI * 2.2) * 80;
    // The lower glow follows a different curve, drawing the eye toward the footer.
    const bottomDrift = Math.sin(progress * Math.PI * 2.8 + .35) * 120;
    const distanceFromEnd = maxScroll - scrollTop;
    const nearFooter = clamp(1 - distanceFromEnd / Math.max(viewportHeight * 1.6, 550), 0, 1);
    const bottomAlpha = .13 + .23 * nearFooter;

    element.style.setProperty('--motivo-glow-top-x', `${topDrift.toFixed(1)}px`);
    element.style.setProperty('--motivo-glow-bottom-x', `${bottomDrift.toFixed(1)}px`);
    element.style.setProperty('--motivo-glow-bottom-alpha', bottomAlpha.toFixed(3));
  }

  function schedulePaint() {
    if (framePending) return;
    framePending = true;
    if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(paint);
    else paint();
  }

  function preferenceChanged() {
    if (reducedMotion && reducedMotion.matches) resetMotion();
    else schedulePaint();
  }

  if (reducedMotion) {
    if (typeof reducedMotion.addEventListener === 'function')
      reducedMotion.addEventListener('change', preferenceChanged);
    else if (typeof reducedMotion.addListener === 'function')
      reducedMotion.addListener(preferenceChanged);
  }

  root.addEventListener('scroll', schedulePaint, {passive: true});
  root.addEventListener('resize', schedulePaint, {passive: true});
  root.addEventListener('pageshow', schedulePaint);
  // A page with dynamically loaded shop records may grow after initial paint.
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', schedulePaint, {once: true});
  schedulePaint();
})(typeof window !== 'undefined' ? window : null);
