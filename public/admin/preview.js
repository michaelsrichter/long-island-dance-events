// Simple, readable previews for editors. Styles come from the site's own colors.
(function () {
  if (!window.CMS) return;
  var h = window.h || (window.React && window.React.createElement);
  if (!h) return;
  window.CMS.registerPreviewStyle('/admin/preview.css');

  var EventPreview = function (props) {
    var get = function (k) { return props.entry.getIn(['data', k]); };
    var status = get('status');
    return h('article', { className: 'pv' },
      status && status !== 'scheduled' ? h('p', { className: 'pv-status pv-' + status }, String(status).toUpperCase()) : null,
      h('h1', null, get('title') || 'Untitled event'),
      h('p', { className: 'pv-when' }, (get('startDateTime') || get('occurrenceDate') || 'Date not set') + (get('lessonStartTime') ? ' · Lesson ' + get('lessonStartTime') : '') + (get('danceStartTime') ? ' · Dancing ' + get('danceStartTime') : '')),
      get('summary') ? h('p', { className: 'pv-summary' }, get('summary')) : null,
      get('cancelledMessage') ? h('p', { className: 'pv-alert' }, get('cancelledMessage')) : null,
      h('div', { className: 'pv-body' }, props.widgetFor('body'))
    );
  };
  window.CMS.registerPreviewTemplate('events', EventPreview);
  window.CMS.registerPreviewTemplate('series', EventPreview);
})();
