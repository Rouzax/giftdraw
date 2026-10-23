// The server already counts a filled-in detail as ticking its box; this
// shows that tick while typing. Unticking empties the detail, because a
// detail left behind would tick the box again on save, but keeps the text
// so ticking the box again after a mistaken tap brings it back.
(function () {
  'use strict';

  var fields = document.querySelectorAll('[data-tick]');
  Array.prototype.forEach.call(fields, function (field) {
    var box = document.getElementById(field.getAttribute('data-tick'));
    if (!box) return;
    var kept = '';
    field.addEventListener('input', function () {
      if (field.value.trim()) box.checked = true;
    });
    box.addEventListener('change', function () {
      if (box.checked) {
        if (!field.value) field.value = kept;
      } else {
        kept = field.value;
        field.value = '';
      }
    });
  });
})();
