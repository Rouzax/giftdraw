// The reveal itself is pure CSS; this only lets an impatient tap skip to the
// end and moves focus to the name so screen readers announce it.
(function () {
  'use strict';

  var root = document.querySelector('[data-reveal]');
  if (!root) return;
  var heading = root.querySelector('[data-reveal-focus]');
  var skip = root.querySelector('[data-skip]');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Slightly longer than the CSS timeline, so the confetti has landed. A timer
  // rather than animationend, which never fires where animation is missing.
  var duration = reduced ? 900 : 3400;
  var done = false;

  function finish() {
    if (done) return;
    done = true;
    if (skip) skip.setAttribute('hidden', '');
    if (heading) heading.focus();
  }

  function skipNow() {
    if (done) return;
    root.className += ' is-skipped';
    finish();
  }

  if (skip && !reduced) skip.removeAttribute('hidden');
  root.addEventListener('click', skipNow);
  window.setTimeout(finish, duration);
})();
