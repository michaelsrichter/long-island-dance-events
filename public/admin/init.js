// Runs before Decap CMS loads. Points the GitHub OAuth flow at this site's own /api/auth function,
// so the same config works on production, preview environments and custom domains.
window.CMS_MANUAL_INIT = true;
window.addEventListener('DOMContentLoaded', function () {
  var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  window.CMS.init({
    config: isLocal
      ? { local_backend: true }
      : { backend: { base_url: location.origin, auth_endpoint: 'api/auth' }, site_url: location.origin, display_url: location.origin },
  });
});
