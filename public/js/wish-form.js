// The server already counts a filled-in detail as ticking its box; this
// shows that tick while typing. Unticking clears the detail, because a
// detail left behind would tick the box again on save.
(function () {
  'use strict';

  var fields = document.querySelectorAll('[data-tick]');
  Array.prototype.forEach.call(fields, function (field) {
    var box = document.getElementById(field.getAttribute('data-tick'));
    if (!box) return;
    field.addEventListener('input', function () {
      if (field.value.trim()) box.checked = true;
    });
    box.addEventListener('change', function () {
      if (!box.checked) field.value = '';
    });
  });
})();
