// Decap CMS OAuth popup handshake. Loaded by the /api/callback page (no inline script needed).
(function () {
  var el = document.getElementById('oauth');
  if (!el || !window.opener) return;
  var origin = el.getAttribute('data-origin');
  var message = el.getAttribute('data-message');
  // Only talk to the CMS window on this site's own origin.
  if (origin !== window.location.origin) return;
  function receive(e) {
    if (e.origin !== origin) return;
    window.opener.postMessage(message, origin);
    window.removeEventListener('message', receive, false);
    setTimeout(function () { window.close(); }, 500);
  }
  window.addEventListener('message', receive, false);
  window.opener.postMessage('authorizing:github', origin);
})();
