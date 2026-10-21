// Layered over the per-row swap forms: pick two rows (tap, click or drag one
// onto the other), confirm, and the first row's own form is submitted with
// the second giver filled in. The server checks everything again.
(function () {
  'use strict';

  var list = document.querySelector('[data-arrange]');
  var bar = document.querySelector('[data-arrange-bar]');
  if (!list || !bar || !list.querySelector || !document.documentElement.classList) return;

  var text = bar.querySelector('[data-text]');
  var swapButton = bar.querySelector('[data-swap]');
  var cancelButton = bar.querySelector('[data-cancel]');
  var rows = Array.prototype.slice.call(list.querySelectorAll('.pair[data-giver]'));
  var first = null;
  var second = null;

  function fill(template, values) {
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match;
    });
  }

  function rowOf(node) {
    while (node && node !== list) {
      if (node.nodeType === 1 && node.hasAttribute('data-giver')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function mark(row, on) {
    if (!row) return;
    row.classList.toggle('is-picked', on);
    row.querySelector('.pair-pick').setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function show(message, canSwap) {
    text.textContent = message;
    swapButton.hidden = !canSwap;
    bar.hidden = false;
  }

  function reset() {
    mark(first, false);
    mark(second, false);
    first = null;
    second = null;
    bar.hidden = true;
    text.textContent = '';
  }

  // Swapping with your own receiver, or with whoever gives to you, would
  // leave one of the two giving to themselves.
  function givesSelf(a, b) {
    return a.getAttribute('data-receiver') === b.getAttribute('data-giver')
      || b.getAttribute('data-receiver') === a.getAttribute('data-giver');
  }

  function pick(row) {
    if (row === first) return reset();
    if (!first) {
      first = row;
      mark(first, true);
      return show(fill(bar.getAttribute('data-next'), { a: row.getAttribute('data-name') }), false);
    }
    mark(second, false);
    second = null;
    if (givesSelf(first, row)) return show(bar.getAttribute('data-self'), false);
    second = row;
    mark(second, true);
    show(fill(bar.getAttribute('data-confirm'), {
      a: first.getAttribute('data-name'),
      b: second.getAttribute('data-name'),
    }), true);
    swapButton.focus();
  }

  function submit() {
    if (!first || !second) return;
    var form = first.querySelector('form');
    form.querySelector('select[name="b"]').value = second.getAttribute('data-giver');
    swapButton.disabled = true;
    cancelButton.disabled = true;
    form.submit();
  }

  rows.forEach(function (row) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'pair-pick';
    button.textContent = list.getAttribute('data-pick');
    button.setAttribute('aria-label', fill(list.getAttribute('data-pick-label'), { name: row.getAttribute('data-name') }));
    button.setAttribute('aria-pressed', 'false');
    row.appendChild(button);
  });

  // The whole row is the target, a large one on a phone; the button inside
  // gives keyboard and screen reader users the same action.
  list.addEventListener('click', function (event) {
    var row = rowOf(event.target);
    if (row) pick(row);
  });
  swapButton.addEventListener('click', submit);
  cancelButton.addEventListener('click', reset);
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' || event.key === 'Esc') reset();
  });

  // No drag where the primary pointer is touch: touch browsers that do
  // support drag and drop start it on a long press, which fights scrolling.
  var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (!touch && 'draggable' in document.createElement('li')) {
    var dragging = null;
    var dropped = false;
    var over = null;
    var setOver = function (row) {
      if (over) over.classList.remove('is-drop');
      over = row;
      if (over) over.classList.add('is-drop');
    };
    rows.forEach(function (row) {
      row.setAttribute('draggable', 'true');
    });
    list.addEventListener('dragstart', function (event) {
      var row = rowOf(event.target);
      if (!row) return;
      reset();
      dragging = row;
      dropped = false;
      pick(row);
      row.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      // Firefox only starts a drag that carries data.
      event.dataTransfer.setData('text/plain', row.getAttribute('data-giver'));
    });
    list.addEventListener('dragover', function (event) {
      var row = rowOf(event.target);
      if (!dragging || !row || row === dragging) return setOver(null);
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setOver(row);
    });
    list.addEventListener('drop', function (event) {
      var row = rowOf(event.target);
      if (!dragging || !row || row === dragging) return;
      event.preventDefault();
      setOver(null);
      dropped = true;
      pick(row);
    });
    list.addEventListener('dragend', function () {
      if (dragging) dragging.classList.remove('is-dragging');
      setOver(null);
      // Dropped outside the list: nothing chosen, so start over.
      if (!dropped) reset();
      dragging = null;
    });
  }

  list.classList.add('is-enhanced');
  var howForm = document.querySelector('[data-how-form]');
  var howScript = document.querySelector('[data-how-script]');
  if (howForm) howForm.hidden = true;
  if (howScript) howScript.hidden = false;
})();
