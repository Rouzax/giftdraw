// Opens the print dialog once after "Print" was pressed. The query is taken
// out of the address first, so a reload does not open the dialog again.
(function () {
  'use strict';

  if (!/(^|[?&])print=1(&|$)/.test(window.location.search)) return;
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  window.addEventListener('load', function () {
    window.print();
  });
})();
