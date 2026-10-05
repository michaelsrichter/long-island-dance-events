/**
 * Interactive events map (progressive enhancement). The page already lists every place and event as
 * plain HTML; this script adds a Leaflet map with one pin per place, plus filters and "near me".
 */
import L from 'leaflet';
import { track } from './analytics';
import { fillFilterForm, filterParams, matchesEvent, ranges, readFilterForm, setupFilterPanel, syncFilterLinks } from './event-match';

const mapEl = document.querySelector<HTMLElement>('[data-events-map]');
const list = document.querySelector<HTMLElement>('[data-upcoming-list="map"]');
const form = document.querySelector<HTMLFormElement>('[data-event-filters][data-view="map"]');

interface Place {
  el: HTMLElement;
  id: string;
  name: string;
  /** 'dance' when the place has any dance or live music; 'class' when it only has classes. */
  host: 'dance' | 'class';
  latlng: L.LatLng;
  marker: L.Marker;
  events: HTMLElement[];
  visibleCount: number;
}

const MAX_EVENTS = 3;
const SVG = 'http://www.w3.org/2000/svg';

function pinIcon(host: Place['host']): L.DivIcon {
  const el = document.createElement('span');
  el.className = 'map-pin__shape';
  if (host === 'dance') {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z');
    svg.append(path);
    el.append(svg);
  }
  return L.divIcon({ html: el, className: `map-pin map-pin--${host === 'dance' ? 'home' : 'community'}`, iconSize: [34, 42], iconAnchor: [17, 40], popupAnchor: [0, -36] });
}

function popupFor(p: Place): HTMLElement {
  const box = document.createElement('div');
  box.className = 'map-popup';
  const title = document.createElement('p');
  title.className = 'map-popup__title';
  const nameLink = p.el.querySelector<HTMLAnchorElement>('.map-place__name a');
  if (nameLink) {
    const a = document.createElement('a');
    a.href = nameLink.href;
    a.textContent = p.name;
    title.append(a);
  } else title.textContent = p.name;
  box.append(title);
  const items = p.events.filter((e) => !e.hidden).slice(0, 3);
  const ul = document.createElement('ul');
  ul.className = 'map-popup__events';
  for (const item of items) {
    const li = item.cloneNode(true) as HTMLElement;
    li.removeAttribute('data-event');
    li.removeAttribute('data-map-event');
    ul.append(li);
  }
  box.append(ul);
  const more = p.visibleCount - items.length;
  const actions = document.createElement('p');
  actions.className = 'map-popup__actions';
  const all = document.createElement('a');
  all.href = `#place-${p.id}`;
  all.textContent = more > 0 ? `+${more} more dates` : 'See in the list';
  all.addEventListener('click', (ev) => {
    ev.preventDefault();
    p.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    p.el.focus({ preventScroll: true });
  });
  const dir = p.el.querySelector<HTMLAnchorElement>('a[data-track="get_directions"]');
  actions.append(all);
  if (dir) {
    const d = dir.cloneNode(true) as HTMLAnchorElement;
    d.className = '';
    d.setAttribute('data-track-location', 'map_popup');
    actions.append(document.createTextNode(' · '), d);
  }
  box.append(actions);
  return box;
}

if (mapEl && list) {
  const map = L.map(mapEl, { scrollWheelZoom: false, zoomSnap: 0.5, attributionControl: true });
  // Let the page scroll normally until someone clicks or focuses the map.
  map.on('click focus', () => map.scrollWheelZoom.enable());
  mapEl.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const layer = L.layerGroup().addTo(map);
  const now = Date.now();
  const places: Place[] = [...list.querySelectorAll<HTMLElement>('[data-map-place]')].map((el) => {
    const latlng = L.latLng(Number(el.dataset.lat), Number(el.dataset.lng));
    const host = el.dataset.host === 'dance' ? 'dance' : 'class';
    const name = el.dataset.name ?? '';
    const marker = L.marker(latlng, { icon: pinIcon(host), title: name, keyboard: true, riseOnHover: true, zIndexOffset: host === 'dance' ? 1000 : 0 });
    const events = [...el.querySelectorAll<HTMLElement>('[data-map-event]')];
    for (const e of events) if (Number(e.dataset.end) <= now) e.setAttribute('data-expired', '');
    el.tabIndex = -1;
    const p: Place = { el, id: el.id.replace(/^place-/, ''), name, host, latlng, marker, events, visibleCount: 0 };
    marker.bindPopup(() => popupFor(p), { maxWidth: 300, autoPanPadding: [24, 24] });
    marker.on('click', () => track('select_event', { location: 'map_pin', method: host }));
    el.querySelector('[data-map-focus]')?.addEventListener('click', () => focusPlace(p, true));
    return p;
  });

  function labelMarker(p: Place) {
    const el = p.marker.getElement();
    el?.setAttribute('aria-label', `${p.name}: ${p.visibleCount} upcoming ${p.visibleCount === 1 ? 'event' : 'events'}${p.host === 'dance' ? ', has dances' : ', classes or concerts only'}`);
  }

  function focusPlace(p: Place, fromList = false) {
    if (!layer.hasLayer(p.marker)) return;
    if (fromList && window.matchMedia('(max-width: 59.99rem)').matches) mapEl!.scrollIntoView({ behavior: 'smooth', block: 'start' });
    map.setView(p.latlng, Math.max(map.getZoom(), 13));
    p.marker.openPopup();
    if (fromList) track('select_event', { location: 'map_list' });
  }

  const showActive = form ? setupFilterPanel(form) : () => {};
  const count = form?.querySelector<HTMLElement>('[data-result-count]');
  const empty = document.querySelector<HTMLElement>('[data-map-empty]');
  const unplaced = [...document.querySelectorAll<HTMLElement>('[data-map-unplaced]')];
  const r = ranges();
  /** Old links used ?type=dance|class|all; the list, calendar and map now share ?category=. */
  const LEGACY_TYPE: Record<string, string> = { dance: 'dances', class: 'class-lesson', all: 'all' };

  function apply(source: 'load' | 'change') {
    const v = form ? readFilterForm(form) : ({ category: 'dances' } as ReturnType<typeof readFilterForm>);
    const matches = (e: HTMLElement) => !e.hasAttribute('data-expired') && matchesEvent(e.dataset, e.textContent ?? '', v, r);
    let shown = 0;
    const visible: L.LatLng[] = [];
    for (const p of places) {
      const ok = p.events.filter(matches);
      p.visibleCount = ok.length;
      for (const e of p.events) e.hidden = !ok.includes(e) || ok.indexOf(e) >= MAX_EVENTS;
      const more = p.el.querySelector<HTMLElement>('[data-map-more]');
      if (more) more.hidden = ok.length <= MAX_EVENTS;
      p.el.hidden = ok.length === 0;
      if (ok.length) {
        shown++;
        visible.push(p.latlng);
        if (!layer.hasLayer(p.marker)) layer.addLayer(p.marker);
        labelMarker(p);
      } else layer.removeLayer(p.marker);
    }
    for (const e of unplaced) e.hidden = !matches(e);
    if (count) count.textContent = `${shown} ${shown === 1 ? 'place' : 'places'} shown`;
    if (empty) empty.hidden = shown !== 0;
    if (visible.length) map.fitBounds(L.latLngBounds(visible), { padding: [28, 28], maxZoom: 13 });
    else if (source === 'load') map.setView([40.8, -73.2], 9);
    // Long Island is wide and short: never zoom out further than needed to show the island.
    if (map.getZoom() < 8.5) map.setZoom(8.5);
    if (form) syncFilterLinks(filterParams(v));
    showActive(v);
    if (source === 'change') track('filter_events', { location: 'map', filter: filterParams(v).toString().slice(0, 100) || 'none', results: shown });
  }

  if (form) {
    const params = new URLSearchParams(location.search);
    const legacy = params.get('type');
    if (legacy && !params.get('category') && LEGACY_TYPE[legacy]) params.set('category', LEGACY_TYPE[legacy]!);
    params.delete('type');
    if (['dance', 'county', 'town', 'day', 'price', 'level', 'venue', 'person'].some((k) => params.get(k))) {
      const more = form.querySelector<HTMLDetailsElement>('.filters__more');
      if (more) more.open = true;
    }
    fillFilterForm(form, params);
    // A link to a place that only has classes (e.g. from a venue page) shows everything, so its pin is there.
    const linked = places.find((p) => `#place-${p.id}` === location.hash);
    const category = form.elements.namedItem('category');
    if (linked && !params.get('category') && category instanceof RadioNodeList && linked.events.every((e) => e.dataset.host !== 'dance')) category.value = 'all';
    let debounce: number | undefined;
    form.addEventListener('input', (e) => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => apply('change'), (e.target as HTMLElement).matches('input[type=search]') ? 250 : 0);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      apply('change');
    });
    form.addEventListener('reset', () => setTimeout(() => apply('change'), 0));
  }
  apply('load');

  // Deep links such as /events/map/#place-brumidi-lodge open that pin.
  const target = places.find((p) => `#place-${p.id}` === location.hash);
  if (target) focusPlace(target);

  // "Show dances near me": sort the list by distance and show the nearest places. The location stays in the browser.
  const locate = document.querySelector<HTMLButtonElement>('[data-map-locate]');
  let you: L.CircleMarker | undefined;
  if (locate && 'geolocation' in navigator) {
    locate.addEventListener('click', () => {
      locate.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          locate.disabled = false;
          const here = L.latLng(pos.coords.latitude, pos.coords.longitude);
          you?.remove();
          you = L.circleMarker(here, { radius: 8, className: 'map-you', weight: 3 }).addTo(map).bindTooltip('You are here');
          const sorted = [...places].sort((a, b) => here.distanceTo(a.latlng) - here.distanceTo(b.latlng));
          for (const p of sorted) {
            const miles = here.distanceTo(p.latlng) / 1609.34;
            const label = p.el.querySelector<HTMLElement>('[data-map-distance]');
            if (label) label.textContent = ` · ${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi away`;
            list.append(p.el);
          }
          const nearest = sorted.filter((p) => !p.el.hidden).slice(0, 4).map((p) => p.latlng);
          map.fitBounds(L.latLngBounds([here, ...nearest]), { padding: [36, 36], maxZoom: 13 });
          if (count) count.textContent = `${count.textContent?.replace(/, nearest first$/, '')}, nearest first`;
          track('filter_events', { location: 'map', filter: 'near_me', value: 'granted' });
        },
        () => {
          locate.disabled = false;
          locate.textContent = 'Location not available';
          track('filter_events', { location: 'map', filter: 'near_me', value: 'denied' });
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
      );
    });
  } else if (locate) locate.hidden = true;
}

