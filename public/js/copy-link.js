// The link field works without script: it can be selected and copied by
// hand. This adds a button that copies it in one tap.
(function () {
  'use strict';

  var root = document.querySelector('[data-copy-link]');
  if (!root) return;
  var input = root.querySelector('[data-copy-source]');
  var button = root.querySelector('[data-copy]');
  var status = root.querySelector('[data-copy-status]');
  if (!input || !button) return;

  function say(text) {
    if (status) status.textContent = text;
  }

  // execCommand is the fallback for browsers without the clipboard API or
  // pages it refuses, such as plain http on a local network.
  function legacyCopy() {
    input.focus();
    input.select();
    var ok;
    try {
      ok = document.execCommand('copy');
    } catch (ignored) { // eslint-disable-line no-unused-vars
      ok = false;
    }
    say(root.getAttribute(ok ? 'data-copied' : 'data-failed'));
  }

  input.addEventListener('focus', function () {
    input.select();
  });

  button.addEventListener('click', function () {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(input.value).then(function () {
        say(root.getAttribute('data-copied'));
      }, legacyCopy);
    } else {
      legacyCopy();
    }
  });

  button.removeAttribute('hidden');
})();
