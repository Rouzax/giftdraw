// The import form works without script: the file's text can be pasted.
// This shows a file picker that puts a chosen file's text in the field, so
// nothing but that text is ever posted.
(function () {
  'use strict';

  Array.prototype.forEach.call(document.querySelectorAll('[data-import-form]'), function (form) {
    var input = form.querySelector('[data-import-file]');
    var status = form.querySelector('[data-import-status]');
    var text = form.querySelector('textarea[name="text"]');
    if (!input || !text || typeof window.FileReader !== 'function') return;
    input.parentNode.hidden = false;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      // A file picked by mistake can be huge; reading it into the field
      // would only stall the page before the server refuses it.
      var tooBig = file.size > Number(input.getAttribute('data-max-bytes'));
      if (status) {
        status.textContent = tooBig ? input.getAttribute('data-too-big') : '';
        status.hidden = !tooBig;
      }
      if (tooBig) {
        input.value = '';
        return;
      }
      var reader = new window.FileReader();
      reader.onload = function () {
        text.value = String(reader.result);
        input.value = '';
        text.focus();
      };
      reader.readAsText(file, 'utf-8');
    });
  });
})();
