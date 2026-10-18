/* Motivo v7 | Magnetic liquid motion.
 * No full-document CSS variables are changed while scrolling. The previous
 * script re-painted whole-body gradients and cards continuously, which could
 * stall scrolling. Only three isolated elements receive transform updates.
 */
(function motivoMagneticLiquid(root) {
  'use strict';
  if (!root || !root.document || root.__motivoScrollGradientStarted) return;
  root.__motivoScrollGradientStarted = true;

  const doc = root.document;
  const reduce = typeof root.matchMedia === 'function'
    ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const finePointer = typeof root.matchMedia === 'function'
    ? root.matchMedia('(hover: hover) and (pointer: fine)') : null;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const prefersReducedMotion = () => !!(reduce && reduce.matches);
  const shapes = [
    {px:0,py:0,x:0,y:0,tx:0,ty:0,strength:1},
    {px:0,py:0,x:0,y:0,tx:0,ty:0,strength:-.82},
    {px:0,py:0,x:0,y:0,tx:0,ty:0,strength:.67}
  ];
  let mounted = false;
  let blobs = [];
  let pointerX = 0, pointerY = 0;
  let targetScroll = 0, lastScroll = 0;
  let pending = false, frame = 0;

  function refreshTargets() {
    targetScroll = clamp(root.scrollY || 0, 0, 1000000);
    const delta = targetScroll - lastScroll;
    lastScroll = targetScroll;
    /* Magnetic tug: move across the screen with alternating direction and
     * small vertical oscillation. The target derives from scroll and cursor,
     * not the size or layout of every card on the page. */
    shapes.forEach((shape, index) => {
      const phase = targetScroll / (430 + index * 115) + index * 1.9;
      const magnet = shape.strength;
      shape.tx = Math.sin(phase) * (90 + index * 25) + pointerX * (62 + index * 18) * magnet;
      shape.ty = Math.cos(phase * .77) * (54 + index * 14) + pointerY * (49 + index * 10) * magnet + clamp(delta, -140, 140) * .09 * magnet;
    });
    schedule();
  }

  function paint() {
    pending = false;
    if (prefersReducedMotion() || doc.hidden || !mounted) return;
    let moving = false;
    /* Spring-like easing, but terminate the rAF loop once settled. Ambient
     * undulation continues via compositor-only CSS transforms on child cores. */
    shapes.forEach((shape,index) => {
      shape.x += (shape.tx - shape.x) * .13;
      shape.y += (shape.ty - shape.y) * .12;
      if (Math.abs(shape.tx-shape.x) > .45 || Math.abs(shape.ty-shape.y) > .45) moving = true;
      const el = blobs[index];
      if (el) el.style.transform = 'translate3d(' + shape.x.toFixed(1) + 'px,' + shape.y.toFixed(1) + 'px,0)';
    });
    if (moving) schedule();
  }
  function schedule() {
    if (!mounted || prefersReducedMotion() || doc.hidden || pending) return;
    pending = true;
    frame = root.requestAnimationFrame(paint);
  }
  function onReducedMotionChange() {
    if (prefersReducedMotion()) {
      root.cancelAnimationFrame(frame);
      pending = false;
      shapes.forEach(shape => { shape.x = shape.y = shape.tx = shape.ty = 0; });
      blobs.forEach(el => { el.style.transform = ''; });
    } else refreshTargets();
  }
  function onPointerMove(e) {
    if (!finePointer || !finePointer.matches || prefersReducedMotion()) return;
    pointerX = clamp((e.clientX / Math.max(1,root.innerWidth) -.5) * 2, -1, 1);
    pointerY = clamp((e.clientY / Math.max(1,root.innerHeight) -.5) * 2, -1, 1);
    refreshTargets();
  }
  function mount() {
    if (mounted || !doc.body) return;
    const layer = doc.createElement('div');
    layer.id = 'motivo-liquid-layer';
    layer.setAttribute('aria-hidden', 'true');
    ['a','b','c'].forEach((key) => {
      const blob = doc.createElement('span');
      blob.className = 'motivo-liquid-blob motivo-liquid-blob--' + key;
      const core = doc.createElement('span');
      core.className = 'motivo-liquid-core';
      blob.appendChild(core);
      layer.appendChild(blob);
      blobs.push(blob);
    });
    doc.body.insertBefore(layer, doc.body.firstChild);
    mounted = true;
    root.addEventListener('scroll', refreshTargets, {passive:true});
    root.addEventListener('resize', refreshTargets, {passive:true});
    root.addEventListener('pageshow', refreshTargets);
    if (finePointer) root.addEventListener('pointermove', onPointerMove, {passive:true});
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) { root.cancelAnimationFrame(frame); pending=false; }
      else refreshTargets();
    });
    if (reduce) {
      if (typeof reduce.addEventListener === 'function') reduce.addEventListener('change', onReducedMotionChange);
      else if (typeof reduce.addListener === 'function') reduce.addListener(onReducedMotionChange);
    }
    if (!prefersReducedMotion()) refreshTargets();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, {once:true});
  else mount();
})(typeof window !== 'undefined' ? window : null);
