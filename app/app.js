/*
 * TV Home: the home screen. Runs inside TizenBrew on the TV, or in a desktop browser from tools/dev-server.js.
 * Settings (keys, server addresses) never ship with the app: on the TV they come from the module's own service
 * (service/service.js, filled once from the PC by tools/push-config.js), in a browser from the dev server.
 */
(function () {
  'use strict';

  const DEV = location.port === '5178';
  const SERVICE = DEV ? '' : 'http://127.0.0.1:8093';
  const TIZEN = window.tizen && window.tizen.application ? window.tizen : null;
  const $ = (id) => document.getElementById(id);

  let cfg = null;
  let picks = [], pickAt = 0;
  let zone = 'hero', idx = 0;

  // MARK: - Small helpers

  async function getJSON(url, headers) {
    const r = await fetch(url, { headers: headers || {} });
    if (!r.ok) throw new Error(r.status + ' from ' + url.split('?')[0]);
    return r.json();
  }

  function el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  let toastTimer = 0;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, text.length > 60 ? 10000 : 3000);
  }

  function warn(what, e) { console.warn('[tv-home] ' + what + ':', e && e.message ? e.message : e); }

  // MARK: - Settings

  async function loadConfig() {
    try {
      const c = await getJSON(SERVICE + '/config');
      if (c && c.tmdbKey) {
        try { localStorage.setItem('tvhome.config', JSON.stringify(c)); } catch (e) {}
        return c;
      }
    } catch (e) { warn('settings from the service', e); }
    // The service isn't up yet (TizenBrew starts it alongside us): the copy from last time.
    try {
      const s = localStorage.getItem('tvhome.config');
      if (s) return JSON.parse(s);
    } catch (e) {}
    return null;
  }

  // MARK: - Clock

  function tick() {
    const now = new Date();
    $('clock').textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }

  // MARK: - Weather (Open-Meteo, no key)

  const ICONS = {
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    cloud: '<svg viewBox="0 0 24 24"><path d="M7 17h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 10 3.5 3.5 0 0 0 7 17z"/></svg>',
    rain: '<svg viewBox="0 0 24 24"><path d="M7 15h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8 3.5 3.5 0 0 0 7 15z"/><path d="M9 19l1-2M13 19l1-2M17 19l1-2"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>'
  };
  const isRain = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
  function describe(c) {
    if (c === 0) return 'clear';
    if (c <= 2) return 'partly cloudy';
    if (c === 3) return 'cloudy';
    if (c === 45 || c === 48) return 'fog';
    if (c >= 51 && c <= 57) return 'drizzle';
    if (c >= 71 && c <= 77) return 'snow';
    if (c >= 95) return 'thunder';
    return isRain(c) ? 'rain' : 'cloudy';
  }

  async function weather() {
    const p = cfg.place;
    const w = await getJSON('https://api.open-meteo.com/v1/forecast?latitude=' + p.latitude + '&longitude=' + p.longitude +
      '&current=temperature_2m,weather_code,is_day&hourly=weather_code&forecast_hours=12&timezone=Europe%2FLondon');
    const code = w.current.weather_code;
    let note = describe(code);
    if (!isRain(code)) {
      const i = w.hourly.weather_code.findIndex(isRain);
      if (i > 0) note = 'rain from ' + w.hourly.time[i].slice(11, 16);
      else if (i === -1 && code <= 2) note = 'dry';
    }
    const icon = isRain(code) ? 'rain' : code <= 1 ? (w.current.is_day ? 'sun' : 'moon') : 'cloud';
    $('wx-icon').innerHTML = ICONS[icon];
    $('wx-temp').textContent = Math.round(w.current.temperature_2m) + '°';
    $('wx-text').textContent = p.name + ' · ' + note;
    $('weather').hidden = false;
  }

  // MARK: - Home (Home Assistant, through the service)

  async function home() {
    if (!cfg.homeAssistant) return;
    const h = await getJSON(SERVICE + '/home');
    const box = $('home');
    box.textContent = '';
    // HOME ● Roland   AWAY ● Martyn   GUESTS ● Ed & Julie · 2 devices: a group only when someone's in it.
    function group(label, names, colour) {
      if (!names.length) return;
      const g = el('span', 'group', box);
      el('small', null, g, label);
      for (const n of names) {
        const s = el('span', null, g);
        el('i', 'dot', s).style.background = colour;
        s.appendChild(document.createTextNode(n));
      }
    }
    group('Home', h.people.filter((p) => p.home).map((p) => p.name), '#7EE0A1');
    group('Away', h.people.filter((p) => !p.home).map((p) => p.name), '#5B6472');
    const g = h.guests || {};
    const devices = g.devices ? g.devices + (g.devices === 1 ? ' device' : ' devices') : '';
    if (g.mode || g.devices) {
      group('Guests', [[g.mode ? (g.name || 'Guest staying') : '', devices].filter(Boolean).join(' · ')], '#C9A7FF');
    }
    box.hidden = !box.childNodes.length;
  }

  // MARK: - Trains (through the service, once a National Rail key is set)

  async function trains() {
    if (!cfg.trains || !cfg.trains.enabled) return;
    const t = await getJSON(SERVICE + '/trains');
    const box = $('trains');
    box.textContent = '';
    const head = el('div', 'info', box);
    head.style.marginTop = '0';
    head.innerHTML = '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M9 16l-1 4M15 16l1 4"/></svg>';
    el('span', 'muted', head, 'To ' + t.to);
    for (const d of t.departures.slice(0, cfg.trains.count || 3)) {
      const row = el('div', 'row', box);
      el('b', null, row, d.time);
      const s = el('span', null, row, d.status);
      s.style.color = d.status === 'Cancelled' ? 'var(--bad)' : d.late ? 'var(--late)' : 'var(--good)';
      if (d.arrive) el('small', 'muted', row, 'arrives ' + d.arrive);
    }
    box.hidden = false;
  }

  // MARK: - Your servers: Plex and Jellyfin

  function plexImg(path, w, h) {
    const p = cfg.plex;
    return p.url + '/photo/:/transcode?width=' + w + '&height=' + h + '&minSize=1&upscale=1&url=' +
      encodeURIComponent(path) + '&X-Plex-Token=' + p.token;
  }
  const jfHeaders = () => ({
    Authorization: 'MediaBrowser Client="TV Home", Device="TV Home PC", DeviceId="tv-home-bletchley-01", Version="0.1.0", Token="' + cfg.jellyfin.token + '"'
  });
  const jfImg = (id, type) => cfg.jellyfin.url + '/Items/' + id + '/Images/' + type + '?maxWidth=720&quality=85';

  /** Everything on both servers, with each title's TMDB id so picks can say "on your Plex". */
  async function library() {
    const all = [];
    if (cfg.plex) {
      const p = cfg.plex;
      for (const key of Object.values(p.libraries)) {
        try {
          const d = await getJSON(p.url + '/library/sections/' + key + '/all?includeGuids=1&X-Plex-Token=' + p.token, { Accept: 'application/json' });
          for (const m of d.MediaContainer.Metadata || []) {
            const g = (m.Guid || []).map((x) => x.id).find((id) => id.indexOf('tmdb://') === 0);
            all.push({
              src: 'Plex', title: m.title, year: m.year || null, kind: m.type === 'show' ? 'tv' : 'movie', tmdb: g ? +g.slice(7) : null,
              seen: (m.lastViewedAt || 0) * 1000, added: (m.addedAt || 0) * 1000,
              img: m.art ? plexImg(m.art, 720, 405) : null,
              poster: m.thumb ? plexImg(m.thumb, 300, 450) : null,
              ref: { src: 'Plex', id: m.ratingKey }
            });
          }
        } catch (e) { warn('Plex library ' + key, e); }
      }
    }
    if (cfg.jellyfin) {
      const j = cfg.jellyfin;
      try {
        const d = await getJSON(j.url + '/Users/' + j.userId + '/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds,DateCreated&EnableUserData=true', jfHeaders());
        for (const i of d.Items) {
          all.push({
            src: 'Jellyfin', title: i.Name, year: i.ProductionYear || null, kind: i.Type === 'Series' ? 'tv' : 'movie',
            tmdb: i.ProviderIds && i.ProviderIds.Tmdb ? +i.ProviderIds.Tmdb : null,
            seen: i.UserData && i.UserData.LastPlayedDate ? Date.parse(i.UserData.LastPlayedDate) : 0,
            added: Date.parse(i.DateCreated) || 0,
            img: jfImg(i.Id, 'Backdrop'),
            poster: jfImg(i.Id, 'Primary'),
            ref: { src: 'Jellyfin', id: i.Id, series: i.Type === 'Series' }
          });
        }
      } catch (e) { warn('Jellyfin library', e); }
    }
    return all;
  }

  /**
   * What's on the servers, to look a TMDB title up in: by TMDB id, else by title and year, as a server copy that
   * was never matched to TMDB has no id (Plex had Resident Evil: Welcome to Raccoon City like that).
   */
  function ownedIndex(lib) {
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const byId = new Map(), byName = new Map();
    for (const x of lib) {
      if (x.tmdb && !byId.has(x.kind + ':' + x.tmdb)) byId.set(x.kind + ':' + x.tmdb, x);
      const name = x.kind + ':' + norm(x.title) + ':' + (x.year || '');
      if (!byName.has(name)) byName.set(name, x);
    }
    return {
      /** The server copy of a TMDB result (kind 'movie' or 'tv'), or undefined. */
      find(kind, m) {
        const year = (m.release_date || m.first_air_date || '').slice(0, 4);
        return byId.get(kind + ':' + m.id) || byName.get(kind + ':' + norm(m.title || m.name) + ':' + year);
      }
    };
  }

  /** Part-watched things on either server; with none, the newest additions. */
  async function continueRow(lib) {
    const items = [];
    if (cfg.plex) {
      const p = cfg.plex;
      try {
        const d = await getJSON(p.url + '/library/onDeck?X-Plex-Token=' + p.token, { Accept: 'application/json' });
        for (const m of d.MediaContainer.Metadata || []) {
          const ep = m.type === 'episode';
          items.push({
            title: ep ? m.grandparentTitle : m.title,
            sub: (ep ? 'S' + m.parentIndex + ' E' + m.index + ' · ' : '') + 'Plex',
            pct: m.duration ? Math.round(100 * (m.viewOffset || 0) / m.duration) : 0,
            img: plexImg(ep ? (m.grandparentArt || m.art) : m.art, 720, 405), app: 'Plex',
            ref: { src: 'Plex', id: m.ratingKey, offset: m.viewOffset || 0 }
          });
        }
      } catch (e) { warn('Plex on deck', e); }
    }
    if (cfg.jellyfin) {
      const j = cfg.jellyfin;
      try {
        const d = await getJSON(j.url + '/Users/' + j.userId + '/Items/Resume?Limit=8&MediaTypes=Video', jfHeaders());
        for (const i of d.Items) {
          const ep = i.Type === 'Episode';
          items.push({
            title: ep ? i.SeriesName : i.Name,
            sub: (ep ? 'S' + i.ParentIndexNumber + ' E' + i.IndexNumber + ' · ' : '') + 'Jellyfin',
            pct: Math.round((i.UserData && i.UserData.PlayedPercentage) || 0),
            img: jfImg(i.ParentBackdropItemId || i.Id, 'Backdrop'), app: 'Jellyfin',
            ref: { src: 'Jellyfin', id: i.Id, ticks: (i.UserData && i.UserData.PlaybackPositionTicks) || 0 }
          });
        }
      } catch (e) { warn('Jellyfin resume', e); }
    }
    if (items.length) return { title: 'Continue watching', items: items.slice(0, 4) };
    const recent = lib.filter((x) => x.added).sort((a, b) => b.added - a.added).slice(0, 4)
      .map((x) => ({ title: x.title, sub: x.src, pct: 0, img: x.img, app: x.src, ref: x.ref }));
    return { title: 'Recently added', items: recent };
  }

  function renderContinue(row) {
    const box = $('cont-cards');
    box.textContent = '';
    $('cont-title').textContent = row.title;
    for (const c of row.items) {
      const b = el('button', 'card focusable', box);
      b.dataset.zone = 'cont';
      b.onclick = () => (c.ref ? playOnTV(c.ref, c.title) : openApp(c.app));
      const art = el('div', 'art', b);
      if (c.img) {
        const im = el('img', null, art);
        im.alt = '';
        im.src = c.img;
        im.onerror = () => { im.remove(); };
      }
      if (c.pct) el('i', null, el('div', 'bar', art)).style.width = c.pct + '%';
      const meta = el('div', 'meta', b);
      el('b', null, meta, c.title);
      el('span', null, meta, c.sub);
    }
    $('cont').hidden = !row.items.length;
  }

  // MARK: - A row per app: new and popular on each service (TMDB), the newest on your servers

  async function makeShelves(lib) {
    const T = 'https://api.themoviedb.org/3', key = 'api_key=' + cfg.tmdbKey;
    const region = cfg.region || 'GB', lang = cfg.language || 'en-GB';
    const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const rows = {};

    async function onService(name, id) {
      const get = async (kind) => {
        const date = kind === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte';
        const r = await getJSON(T + '/discover/' + kind + '?' + key + '&language=' + lang + '&watch_region=' + region +
          '&with_watch_providers=' + id + '&with_watch_monetization_types=flatrate|free|ads&sort_by=popularity.desc&' +
          date + '=' + since + '&vote_count.gte=10');
        return r.results.filter((m) => m.poster_path)
          .map((m) => ({ title: m.title || m.name, img: 'https://image.tmdb.org/t/p/w342' + m.poster_path, app: name }));
      };
      try {
        const both = await Promise.all([get('tv'), get('movie')]);
        const items = [];
        for (let i = 0; i < 10; i++) { if (both[0][i]) items.push(both[0][i]); if (both[1][i]) items.push(both[1][i]); }
        if (items.length) rows[name] = { title: 'New & popular on ' + name, items: items.slice(0, 16) };
      } catch (e) { warn('row for ' + name, e); }
    }
    await Promise.all(Object.keys(cfg.services).filter(canOpen).map((n) => onService(n, cfg.services[n])));

    for (const src of ['Plex', 'Jellyfin'].filter(canOpen)) {
      const mine = lib.filter((x) => x.src === src && x.poster).sort((a, b) => b.added - a.added).slice(0, 16)
        .map((x) => ({ title: x.title, img: x.poster, app: src, ref: x.ref }));
      if (mine.length) rows[src] = { title: 'New on your ' + src, items: mine };
    }
    // In the app row's order: Netflix, Apple TV+, Plex, Jellyfin, iPlayer, ITVX, Channel 4.
    const order = [];
    for (const a of APPS) for (const s of a.services) if (rows[s]) order.push(rows[s]);
    return order;
  }

  /** Poster rows: the home screen's (zones shelf0, shelf1, ...) or the search results' (sr0, ...). */
  function renderShelves(list, box, prefix) {
    box = box || $('shelves');
    prefix = prefix || 'shelf';
    box.textContent = '';
    list.forEach((row, n) => {
      const sec = el('section', 'shelf', box);
      el('h2', null, sec, row.title);
      const track = el('div', 'track', sec);
      for (const it of row.items) {
        const b = el('button', 'poster focusable', track);
        b.dataset.zone = prefix + n;
        b.onclick = () => (it.ref ? playOnTV(it.ref, it.title) : it.app ? openApp(it.app) : toast(it.title + " isn't on your services"));
        const art = el('div', 'art', b);
        const im = el('img', null, art);
        im.alt = '';
        im.loading = 'lazy';
        im.src = it.img;
        im.onerror = () => { im.remove(); };
        el('b', null, b, it.title);
        if (it.sub) el('small', null, b, it.sub);
      }
    });
  }

  // MARK: - Search: your servers (from the library already loaded), then TMDB for where else it is

  let libCache = [];
  let searchOpen = false, searchSeq = 0, searchTimer = 0;

  async function searchFor(q) {
    const T = 'https://api.themoviedb.org/3', key = 'api_key=' + cfg.tmdbKey;
    const region = cfg.region || 'GB', lang = cfg.language || 'en-GB';
    const ql = q.toLowerCase();
    const owned = ownedIndex(libCache);
    const mine = libCache.filter((x) => x.title.toLowerCase().indexOf(ql) >= 0 && canOpen(x.src)).slice(0, 20)
      .map((x) => ({ title: x.title, img: x.poster, app: x.src, ref: x.ref, sub: 'Your ' + x.src }));

    const r = await getJSON(T + '/search/multi?' + key + '&language=' + lang + '&include_adult=false&query=' + encodeURIComponent(q));
    const hits = r.results.filter((m) => (m.media_type === 'movie' || m.media_type === 'tv') && m.poster_path &&
      !owned.find(m.media_type, m)).slice(0, 16);
    const found = await Promise.all(hits.map(async (m) => {
      const item = { title: m.title || m.name, img: 'https://image.tmdb.org/t/p/w342' + m.poster_path };
      try {
        const p = await getJSON(T + '/' + m.media_type + '/' + m.id + '/watch/providers?' + key);
        const here = p.results[region] || {};
        const on = (list) => Object.keys(cfg.services).find((n) => canOpen(n) && (list || []).some((o) => o.provider_id === cfg.services[n]));
        const paid = on(here.flatrate), free = on(here.free) || on(here.ads);
        if (paid || free) return Object.assign(item, { app: paid || free, sub: 'On ' + (paid || free) + (paid ? '' : ' · free') });
      } catch (e) { warn('providers', e); }
      return Object.assign(item, { sub: 'Not on your services' });
    }));
    return [
      { title: 'On your servers', items: mine },
      { title: 'On your services', items: found.filter((x) => x.app) },
      { title: 'Elsewhere', items: found.filter((x) => !x.app) }
    ].filter((row) => row.items.length);
  }

  async function runSearch(q) {
    const seq = ++searchSeq;
    if (q.trim().length < 2) {
      $('search-results').textContent = '';
      $('search-status').textContent = 'Your servers first, then your streaming services.';
      return;
    }
    $('search-status').textContent = 'Searching for "' + q.trim() + '"…';
    let rows;
    try { rows = await searchFor(q.trim()); } catch (e) { warn('search', e); rows = null; }
    if (seq !== searchSeq) return;                   // typed on since
    if (!rows) { $('search-status').textContent = "Couldn't search just now"; return; }
    renderShelves(rows, $('search-results'), 'sr');
    $('search-status').textContent = rows.length ? '' : 'Nothing found for "' + q.trim() + '"';
  }

  $('q').oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch($('q').value), 600);
  };

  function openSearch() {
    searchOpen = true;
    $('search').hidden = false;
    zone = 'search-input';
    idx = 0;
    focus();
    $('q').focus();                                  // brings up the TV's keyboard
  }

  function closeSearch() {
    $('q').blur();
    searchOpen = false;
    $('search').hidden = true;
    zone = 'top';
    idx = 0;
    focus();
  }

  // MARK: - Picks (TMDB): only what's on your services or your servers

  async function makePicks(lib) {
    const T = 'https://api.themoviedb.org/3', key = 'api_key=' + cfg.tmdbKey;
    const region = cfg.region || 'GB', lang = cfg.language || 'en-GB';
    const owned = ownedIndex(lib);

    // Things like what you watched last, then what's popular on your services lately.
    const cands = [];
    const seeds = lib.filter((x) => x.tmdb && x.seen).sort((a, b) => b.seen - a.seen).slice(0, 3);
    for (const s of seeds) {
      try {
        const r = await getJSON(T + '/' + s.kind + '/' + s.tmdb + '/recommendations?' + key + '&language=' + lang);
        r.results.slice(0, 8).forEach((m) => cands.push({ m: m, kind: s.kind, reason: 'Because you watched ' + s.title }));
      } catch (e) { warn('recommendations', e); }
    }
    const providers = Object.values(cfg.services).join('|');
    const since = new Date(Date.now() - 540 * 864e5).toISOString().slice(0, 10);
    for (const kind of ['tv', 'movie']) {
      const date = kind === 'tv' ? 'first_air_date.gte' : 'primary_release_date.gte';
      try {
        const r = await getJSON(T + '/discover/' + kind + '?' + key + '&language=' + lang + '&watch_region=' + region +
          '&with_watch_providers=' + providers + '&with_watch_monetization_types=flatrate|free|ads&sort_by=popularity.desc&' +
          date + '=' + since + '&vote_count.gte=40');
        r.results.slice(0, 10).forEach((m) => cands.push({ m: m, kind: kind, reason: kind === 'tv' ? 'Popular series on your services' : 'Popular film on your services' }));
      } catch (e) { warn('discover ' + kind, e); }
    }
    // Recommendations and popular, taken in turns, so the hero isn't all one kind.
    const recs = cands.filter((c) => c.reason.indexOf('Because') === 0), pop = cands.filter((c) => c.reason.indexOf('Because') !== 0);
    const order = [];
    for (let i = 0; i < Math.max(recs.length, pop.length); i++) {
      if (recs[i]) order.push(recs[i]);
      if (pop[i]) order.push(pop[i]);
    }

    // A backdrop that's nearly black leaves the top of the screen looking empty: another of the title's, or skip it.
    const DARK = 45;
    function luma(url) {
      return new Promise((resolve) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => {
          try {
            const c = document.createElement('canvas');
            c.width = 32; c.height = 18;
            const x = c.getContext('2d');
            x.drawImage(im, 0, 0, 32, 18);
            const d = x.getImageData(0, 0, 32, 18).data;
            let sum = 0;
            for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            resolve(sum / (d.length / 4));
          } catch (e) { resolve(255); }   // can't measure it: keep it
        };
        im.onerror = () => resolve(0);
        im.src = url;
      });
    }
    async function brightBackdrop(kind, id, first) {
      if (await luma('https://image.tmdb.org/t/p/w300' + first) >= DARK) return first;
      try {
        const r = await getJSON(T + '/' + kind + '/' + id + '/images?' + key + '&include_image_language=null,en');
        for (const b of (r.backdrops || []).slice(0, 5)) {
          if (b.file_path !== first && await luma('https://image.tmdb.org/t/p/w300' + b.file_path) >= DARK) return b.file_path;
        }
      } catch (e) { warn('backdrops', e); }
      return null;
    }

    const seen = new Set(), out = [];
    for (const c of order) {
      if (out.length >= 6) break;
      const id = c.kind + ':' + c.m.id;
      if (seen.has(id) || !c.m.backdrop_path) continue;
      seen.add(id);
      const mine = owned.find(c.kind, c.m);
      if (mine && mine.seen) continue;               // already watched
      let where = mine ? mine.src : null;
      if (!where) {
        try {
          const p = await getJSON(T + '/' + c.kind + '/' + c.m.id + '/watch/providers?' + key);
          const here = p.results[region] || {};
          const offers = [].concat(here.flatrate || [], here.free || [], here.ads || []);
          const hit = Object.keys(cfg.services).find((n) => offers.some((o) => o.provider_id === cfg.services[n]));
          if (hit) where = hit;
        } catch (e) { warn('providers', e); }
      }
      if (!where || !canOpen(where)) continue;
      const bg = await brightBackdrop(c.kind, c.m.id, c.m.backdrop_path);
      if (!bg) continue;
      out.push({
        title: c.m.title || c.m.name,
        backdrop: 'https://image.tmdb.org/t/p/w1280' + bg,
        where: where, mine: !!mine, ref: mine ? mine.ref : null,
        reason: c.reason,
        kind: c.kind === 'tv' ? 'Series' : 'Film'
      });
    }
    return out;
  }

  function showPick(i) {
    if (!picks.length) return;
    pickAt = (i + picks.length) % picks.length;
    const p = picks[pickAt];
    const img = $('backdrop');
    img.classList.remove('shown');
    const next = new Image();
    next.onload = () => { img.src = p.backdrop; img.classList.add('shown'); };
    next.src = p.backdrop;
    $('pick-where').textContent = (p.mine ? 'On your ' : 'On ') + p.where + ' · ' + p.kind;
    $('pick-title').textContent = p.title;
    $('pick-reason').textContent = p.reason;
    $('pick-open-label').textContent = 'Open ' + appFor(p.where).name;
    const dots = $('dots');
    dots.textContent = '';
    picks.forEach((_, k) => el('span', k === pickAt ? 'on' : null, dots));
  }

  // MARK: - Apps on the TV

  const APPS = [
    // ids: Samsung's app ids, for when the name the TV lists doesn't match (Plex is 3201512006963 on a 2021 QN95A).
    // tvIcon: the TV's own icon is a good one (seen on a QN95A); the others show Tizen's pinwheel or a test card.
    // logo: a Simple Icons logo, in fg on bg, for those; no logo (BBC iPlayer has none): the name, in fg on bg.
    { name: 'Netflix', match: /^netflix$/i, ids: ['3201907018807', '11101200001'], tvIcon: true, logo: 'netflix', fg: '#E50914', bg: '#000000', services: ['Netflix'] },
    { name: 'Apple TV', match: /^apple ?tv/i, ids: ['3201807016597'], tvIcon: true, logo: 'appletv', fg: '#FFFFFF', bg: '#111111', services: ['Apple TV+'] },
    { name: 'Plex', match: /\bplex\b/i, ids: ['3201512006963'], logo: 'plex', fg: '#E5A00D', bg: '#1F1F1F', services: ['Plex'] },
    { name: 'Jellyfin', match: /jellyfin/i, tvIcon: true, logo: 'jellyfin', fg: '#B9A6FF', bg: '#1D1740', services: ['Jellyfin'] },
    { name: 'BBC iPlayer', match: /iplayer/i, fg: '#FFFFFF', bg: '#E5267E', services: ['BBC iPlayer'] },
    { name: 'ITVX', match: /^itvx|itv hub/i, tvIcon: true, logo: 'itvx', fg: '#1A1A1A', bg: '#E6F93C', services: ['ITVX'] },
    { name: 'Channel 4', match: /^channel ?4|^all ?4/i, logo: 'channel4', fg: '#FFFFFF', bg: '#23232F', services: ['Channel 4'] },
    { name: 'YouTube', match: /^youtube$/i, logo: 'youtube', fg: '#FFFFFF', bg: '#FF0033', services: [] },
    { name: 'Freesat', id: 'org.tizen.tv-viewer', fg: '#9CC7FF', bg: '#0F2A44', services: [] }
  ];
  // Simple Icons, coloured by their CDN: a plain <img> (the TV's Chromium can't tint with CSS masks).
  const logoURL = (slug, colour) => 'https://cdn.simpleicons.org/' + slug + '/' + colour.replace('#', '');
  const appFor = (service) => APPS.find((a) => a.services.indexOf(service) >= 0) || { name: service };
  /** Whether this TV has the app for a service (anything goes until the TV's app list is known, as on the PC). */
  const canOpen = (service) => !appsKnown || !!appFor(service).id;

  function matchApps(list) {
    for (const a of APPS) {
      if (a.id) continue;
      // Several apps can match ("Plex" and a hidden helper of it): the one named exactly so, then one shown in the
      // TV's own app list, then a known id, then any.
      const all = list.filter((x) => (a.ids && a.ids.indexOf(x.id) >= 0) || (a.match && a.match.test(x.name || '')));
      const exact = (x) => (x.name || '').trim().toLowerCase() === a.name.toLowerCase();
      const hit = all.find((x) => exact(x) && x.show !== false) || all.find(exact) ||
        all.find((x) => x.show !== false) || all[0];
      if (hit) { a.id = hit.id; a.hasIcon = !!hit.icon; }
    }
  }

  let appsKnown = false;
  function findApps(done) {
    if (!TIZEN) {
      if (DEV) { done(); return; }
      // Inside TizenBrew: the service lists them.
      getJSON(SERVICE + '/apps').then((list) => { matchApps(list); appsKnown = true; done(); }, () => done());
      return;
    }
    appsKnown = true;
    try {
      TIZEN.application.getAppsInfo((list) => { matchApps(list); done(); }, () => done());
    } catch (e) { done(); }
  }

  function renderApps() {
    const box = $('apps');
    box.textContent = '';
    for (const a of APPS) {
      if (appsKnown && !a.id) continue;              // not installed on this TV
      const b = el('button', 'app focusable', box);
      b.dataset.zone = 'apps';
      b.onclick = () => launch(a);
      const t = el('span', 'tile', b, a.name);
      t.style.background = a.bg;
      t.style.color = a.fg;
      el('span', 'name', b, a.name);
      // The app's own icon from the TV; else its logo on the brand's colour; else its name. The name shows until
      // an image has loaded, and stays if none can.
      const logo = () => {
        if (!a.logo) return;
        const im = new Image();
        im.alt = '';
        im.className = 'logo';
        im.onload = () => { t.textContent = ''; t.appendChild(im); };
        im.src = logoURL(a.logo, a.fg);
      };
      if (a.tvIcon && a.hasIcon) {
        const im = new Image();
        im.alt = '';
        im.onload = () => { t.textContent = ''; t.classList.add('with-icon'); t.appendChild(im); };
        im.onerror = logo;
        im.src = SERVICE + '/icon?id=' + encodeURIComponent(a.id);
      } else logo();
    }
  }

  function launch(a) {
    if (DEV) { toast('On the TV this opens ' + a.name); return; }
    if (!a.id) { toast(appsKnown ? a.name + " isn't installed on this TV" : "Can't open apps yet: the helper isn't running"); return; }
    const failed = () => toast("Couldn't open " + a.name);
    if (!TIZEN) {
      // The service tries each way to open it; if none works, say why (and which app id), to fix it from.
      fetch(SERVICE + '/launch?id=' + encodeURIComponent(a.id))
        .then((r) => r.ok ? null : r.json().then((b) => toast("Couldn't open " + a.name + ' (' + a.id + '): ' + b.error)))
        .catch(failed);
      return;
    }
    try {
      TIZEN.application.launch(a.id, null, failed);
    } catch (e) { failed(); }
  }

  // MARK: - TizenBrew: our service's state, and starting it when it isn't running

  // TizenBrew serves us at /module/<the module's name, encoded>/app/index.html: the name it knows us by.
  const served = location.pathname.split('/')[2];
  const MODULE = { fullName: served ? decodeURIComponent(served) : 'gh/dantesden67/tv-home@main', serviceFile: 'service/service.js' };
  function brewStatus() {
    return new Promise((resolve) => {
      let ws;
      const finish = (text) => { try { ws.close(); } catch (e) {} resolve(text); };
      setTimeout(() => finish('TizenBrew gave no answer'), 4000);
      try { ws = new WebSocket('ws://127.0.0.1:8081'); } catch (e) { resolve("Can't reach TizenBrew"); return; }
      ws.onopen = () => ws.send(JSON.stringify({ type: 7 }));        // GetServiceStatuses
      ws.onerror = () => finish("Can't reach TizenBrew");
      ws.onmessage = (m) => {
        let msg;
        try { msg = JSON.parse(m.data); } catch (e) { return; }
        if (msg.type !== 7) return;
        const mine = (msg.payload || []).find((s) => s.name === MODULE.fullName);
        if (!mine || mine.hasCrashed) ws.send(JSON.stringify({ type: 6, payload: MODULE }));   // StartService
        if (!mine) finish('TizenBrew had not started it; asked it to');
        else if (mine.hasCrashed) finish('it crashed (' + JSON.stringify(mine.error) + '); restarting it');
        else finish('TizenBrew says it is running');
      };
    });
  }
  function openApp(service) { launch(appFor(service)); }

  // MARK: - Playing a title from your own servers: open the app, then have the server start it there

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Jellyfin's remote control: once the TV's Jellyfin app shows up as a session, tell it to play. */
  async function jellyfinPlay(ref) {
    const j = cfg.jellyfin, h = jfHeaders();
    let id = ref.id, ticks = ref.ticks || 0;
    if (ref.series) {   // a series: the next episode to watch, else its first
      const next = await getJSON(j.url + '/Shows/NextUp?SeriesId=' + id + '&UserId=' + j.userId + '&Limit=1', h);
      const ep = next.Items[0] || (await getJSON(j.url + '/Shows/' + id + '/Episodes?UserId=' + j.userId + '&Limit=1', h)).Items[0];
      if (!ep) throw new Error('no episodes');
      id = ep.Id;
      ticks = (ep.UserData && ep.UserData.PlaybackPositionTicks) || 0;
    }
    const tvIp = cfg.tv && cfg.tv.ip;
    for (let i = 0; i < 15; i++) {
      const sessions = await getJSON(j.url + '/Sessions?ActiveWithinSeconds=300', h);
      const remote = sessions.filter((s) => s.SupportsRemoteControl && s.DeviceId !== 'tv-home-bletchley-01');
      const s = remote.find((x) => tvIp && (x.RemoteEndPoint || '').indexOf(tvIp) === 0) ||
        remote.find((x) => /samsung|tizen/i.test((x.DeviceName || '') + ' ' + (x.Client || '')));
      if (s) {
        const r = await fetch(j.url + '/Sessions/' + s.Id + '/Playing?playCommand=PlayNow&itemIds=' + id +
          (ticks ? '&startPositionTicks=' + ticks : ''), { method: 'POST', headers: h });
        if (!r.ok) throw new Error('Jellyfin answered ' + r.status);
        return;
      }
      await sleep(2000);
    }
    throw new Error("the Jellyfin app didn't connect");
  }

  /** Plex: the service asks the TV's Plex app (a Plex player) to play it, retrying while the app starts. */
  async function plexPlay(ref) {
    let last;
    for (let i = 0; i < 15; i++) {
      try { await getJSON(SERVICE + '/plexplay?key=' + ref.id + '&offset=' + (ref.offset || 0)); return; } catch (e) { last = e; }
      await sleep(2000);
    }
    throw last;
  }

  async function playOnTV(ref, title) {
    launch(appFor(ref.src));
    if (DEV) return;
    toast('Starting ' + title + ' in ' + ref.src);
    try {
      await (ref.src === 'Jellyfin' ? jellyfinPlay(ref) : plexPlay(ref));
    } catch (e) {
      warn('play ' + title, e);
      toast("Couldn't start " + title + ' by itself: find it in ' + ref.src);
    }
  }

  // MARK: - Remote control

  const zones = () => searchOpen
    ? ['search-input'].concat(Array.prototype.map.call(document.querySelectorAll('#search-results .shelf'), (_, n) => 'sr' + n))
    : ['top', 'hero', 'apps', 'cont'].concat(Array.prototype.map.call(document.querySelectorAll('#shelves .shelf'), (_, n) => 'shelf' + n));
  const inZone = (z) => Array.prototype.filter.call(document.querySelectorAll('.focusable[data-zone="' + z + '"]'), (e) => e.offsetParent !== null);

  function focus() {
    document.querySelectorAll('.focus').forEach((e) => e.classList.remove('focus'));
    const list = inZone(zone);
    if (!list.length) return;
    idx = Math.max(0, Math.min(idx, list.length - 1));
    const f = list[idx];
    f.classList.add('focus');
    // A row longer than the screen slides along to keep the focus in view.
    const track = f.parentNode;
    if (track.classList.contains('track')) {
      let shift = +(track.dataset.shift || 0);
      if (f.offsetLeft + f.offsetWidth - shift > 1760) shift = f.offsetLeft + f.offsetWidth - 1760;
      if (f.offsetLeft - shift < 0) shift = f.offsetLeft;
      track.dataset.shift = shift;
      track.style.transform = 'translateX(' + (-shift) + 'px)';
    }
    // Below Continue watching (or below the search box), the page moves up so the row sits near the top.
    const shelf = f.closest('.shelf');
    const page = searchOpen ? $('search-page') : $('page');
    page.style.transform = shelf ? 'translateY(' + (-(shelf.offsetTop - 120)) + 'px)' : '';
    $('search-head').classList.toggle('on', zone === 'search-input');
  }

  function moveZone(d) {
    const all = zones();
    let z = all.indexOf(zone);
    do { z += d; } while (z >= 0 && z < all.length && !inZone(all[z]).length);
    if (z < 0 || z >= all.length) return;
    zone = all[z];
    idx = 0;
    focus();
  }

  // Tizen's on-screen keyboard: Done and Cancel.
  const IME_DONE = 65376, IME_CANCEL = 65385;

  document.addEventListener('keydown', (e) => {
    // Typing in the search box: the keys are the keyboard's, except leaving it.
    if (document.activeElement === $('q')) {
      const k = e.keyCode;
      if (k === 13 || k === IME_DONE || k === 40) {
        $('q').blur();
        clearTimeout(searchTimer);
        runSearch($('q').value).then(() => moveZone(1));
      } else if (k === IME_CANCEL || k === 10009 || k === 27) {
        $('q').blur();
      } else return;
      e.preventDefault();
      return;
    }
    switch (e.keyCode) {
      case 37: idx--; focus(); break;                                  // left
      case 39: idx++; focus(); break;                                  // right
      case 38: moveZone(-1); break;                                    // up
      case 40: moveZone(1); break;                                     // down
      case 13: {                                                       // OK
        const f = document.querySelector('.focus');
        if (f === $('q')) $('q').focus(); else if (f) f.click();
        break;
      }
      case 10009: case 27: case 8:                                     // Back
        if (searchOpen) { if (zone === 'search-input') closeSearch(); else { zone = 'search-input'; idx = 0; focus(); } }
        else if (zone !== 'hero') { zone = 'hero'; idx = 0; focus(); }
        break;
      default: return;
    }
    e.preventDefault();
  });

  $('search-bar').onclick = openSearch;
  $('pick-open').onclick = () => {
    if (!picks.length) return;
    const p = picks[pickAt];
    if (p.ref) playOnTV(p.ref, p.title); else openApp(p.where);
  };
  $('pick-next').onclick = () => showPick(pickAt + 1);

  // MARK: - Start

  // The last screen, kept on the TV: shown at once on start while the fresh one loads.
  const saved = {};
  function keep(part, value) {
    saved[part] = value;
    try { localStorage.setItem('tvhome.screen', JSON.stringify(saved)); } catch (e) {}
  }
  function showSaved() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem('tvhome.screen') || 'null'); } catch (e) {}
    if (!s) return;
    Object.assign(saved, s);
    if (s.cont) renderContinue(s.cont);
    if (s.shelves) renderShelves(s.shelves);
    if (s.picks && s.picks.length) { picks = s.picks; showPick(0); }
    focus();
  }

  async function refreshContent() {
    const lib = await library();
    libCache = lib;
    try { const row = await continueRow(lib); renderContinue(row); keep('cont', row); } catch (e) { warn('continue row', e); }
    try { const list = await makeShelves(lib); renderShelves(list); keep('shelves', list); } catch (e) { warn('rows', e); }
    try {
      const fresh = await makePicks(lib);
      if (fresh.length) { picks = fresh; showPick(0); keep('picks', fresh); }
    } catch (e) { warn('picks', e); }
    focus();
  }

  async function start() {
    tick();
    setInterval(tick, 5000);
    findApps(() => { renderApps(); focus(); });
    focus();

    cfg = await loadConfig();
    // Not set up: say whether the service is up (so the PC can send the settings), and wait for them.
    while (!cfg) {
      let status;
      try {
        const p = await getJSON(SERVICE + '/ping');
        status = 'Helper running (Node ' + p.node + ', file ' + (p.fileOk ? 'ok' : 'not writable') + '): send the settings from your PC';
      } catch (e) {
        status = 'Helper not reachable (' + (e.message || e) + '): ' + await brewStatus();
      }
      $('pick-where').textContent = 'Setup';
      $('pick-title').textContent = 'Not set up yet';
      $('pick-reason').textContent = status;
      await new Promise((r) => setTimeout(r, 5000));
      cfg = await loadConfig();
    }
    showSaved();
    // The TV's real app list before choosing rows and picks, so none of them is for an app it hasn't got.
    if (!appsKnown) await new Promise((r) => findApps(() => { renderApps(); focus(); r(); }));
    const safely = (name, fn) => () => fn().catch((e) => warn(name, e));
    const wx = safely('weather', weather), hm = safely('home', home), tr = safely('trains', trains);
    wx(); hm(); tr();
    setInterval(wx, 15 * 60e3);
    setInterval(hm, 60e3);
    setInterval(tr, 60e3);
    refreshContent();
    setInterval(refreshContent, 3 * 3600e3);
    // The hero moves on by itself while you're elsewhere on the screen.
    setInterval(() => { if (zone !== 'hero') showPick(pickAt + 1); }, 12e3);
  }

  start();
})();
