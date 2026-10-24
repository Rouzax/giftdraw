// Disables a form's buttons once it is sent, so a double click does not
// post twice. Only a courtesy: the server already sends a repeated post of
// the same form to the first one's result.
(function () {
  'use strict';

  var MARK = 'data-sent';

  document.addEventListener('submit', function (event) {
    var form = event.target;
    // After the event, not during it: a button disabled while the submit
    // event runs is left out of the posted data, and the language switch
    // posts its choice as the pressed button's value.
    setTimeout(function () {
      if (event.defaultPrevented) return;
      var buttons = form.querySelectorAll('button, input[type="submit"]');
      Array.prototype.forEach.call(buttons, function (button) {
        if (button.disabled) return;
        button.disabled = true;
        button.setAttribute(MARK, '');
      });
    }, 0);
  });

  // Back to a page kept in the browser's memory: its forms may be used again.
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    Array.prototype.forEach.call(document.querySelectorAll('[' + MARK + ']'), function (button) {
      button.disabled = false;
      button.removeAttribute(MARK);
    });
  });
})();
