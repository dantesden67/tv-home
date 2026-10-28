/*
 * TV Home's service: TizenBrew runs it on the TV next to the app. Plain ES5, as older TVs run an old Node.
 *  - GET  /config  the app's settings, to the app only (127.0.0.1)
 *  - POST /config  the settings, sent once from the PC (tools/push-config.js); kept in a file on the TV
 *  - GET  /home    who's home, from Home Assistant (the app can't call it directly: CORS)
 *  - GET  /trains  the next departures, from National Rail (CORS again, and the key stays out of the page)
 *  - GET  /apps, /launch?id=, /icon?id=  the TV's apps, opening one, and its icon (TizenBrew's pages have no
 *         tizen.application, and can't read the icon files)
 *  - GET  /plexplay?key=&offset=  play a title from the Plex server in the TV's Plex app
 * The settings hold keys, so they never go in the published module.
 */
// Node's own modules only: TizenBrew's service is bundled, so it can't lend us packages like node-fetch.
var http = require('http');
var https = require('https');
var fs = require('fs');
var crypto = require('crypto');
var parse = require('url').parse;

/** GET a document as text: done(error, text). */
function getText(address, headers, done) {
  var u = parse(address);
  var req = (u.protocol === 'https:' ? https : http).request({
    method: 'GET', hostname: u.hostname, port: u.port, path: u.path, headers: headers || {}
  }, function (res) {
    var text = '';
    res.setEncoding('utf8');
    res.on('data', function (c) { text += c; });
    res.on('end', function () {
      if (res.statusCode < 200 || res.statusCode >= 300) return done(new Error('HTTP ' + res.statusCode + ' from ' + u.hostname));
      done(null, text);
    });
  });
  req.on('error', done);
  req.setTimeout(15000, function () { req.abort(); });
  req.end();
}

/** GET a JSON document: done(error, body). */
function getJSON(address, headers, done) {
  getText(address, headers, function (err, text) {
    if (err) return done(err);
    try { done(null, JSON.parse(text)); } catch (e) { done(e); }
  });
}

/**
 * Plays something from the Plex server in the TV's Plex app, which is a Plex player listening on port 32500 here
 * (Plex's remote control). A show plays its next episode (On Deck), else its first. Fails until the app is up.
 */
/**
 * Opens an app, trying each way the TV offers: some apps refuse a plain launch but take an app control, and
 * Samsung's own remote-control API (port 8001) opens them by their store id. Reports every reason if all fail.
 */
function launch(id, res) {
  var reasons = [];
  function fail(how) { return function (e) { reasons.push(how + ': ' + (e && (e.message || e.name) || e)); next(); }; }
  var ways = [
    function () { tizen.application.launch(id, done, fail('launch')); },
    function () {
      tizen.application.launchAppControl(new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default'),
        id, done, fail('app control'));
    },
    function () {
      var r = http.request({ method: 'POST', hostname: '127.0.0.1', port: 8001, path: '/api/v2/applications/' + encodeURIComponent(id) },
        function (answer) {
          answer.resume();
          if (answer.statusCode >= 200 && answer.statusCode < 300) done();
          else fail('remote API')(new Error('HTTP ' + answer.statusCode));
        });
      r.on('error', fail('remote API'));
      r.setTimeout(5000, function () { r.abort(); });
      r.end();
    }
  ];
  var finished = false;
  function done() { if (!finished) { finished = true; send(res, 200, { ok: true }); } }
  function next() {
    if (finished) return;
    var way = ways.shift();
    if (!way) { finished = true; return send(res, 500, { error: reasons.join('; ') }); }
    try { way(); } catch (e) { fail('error')(e); }
  }
  next();
}

var commandID = 0;
function plexPlay(req, res) {
  var p = config && config.plex;
  if (!p || !p.machineId) return send(res, 404, { error: 'Plex not set up' });
  var q = require('querystring').parse(req.url.split('?')[1] || '');
  var server = parse(p.url), json = { Accept: 'application/json' };
  getJSON(p.url + '/library/metadata/' + q.key + '?includeOnDeck=1&X-Plex-Token=' + p.token, json, function (err, meta) {
    if (err) return send(res, 502, { error: String(err) });
    var m = meta.MediaContainer.Metadata[0];
    if (m.type !== 'show') return play(q.key, +q.offset || 0);
    var deck = m.OnDeck && m.OnDeck.Metadata && m.OnDeck.Metadata[0];
    if (deck) return play(deck.ratingKey, deck.viewOffset || 0);
    getJSON(p.url + '/library/metadata/' + q.key + '/allLeaves?X-Plex-Token=' + p.token, json, function (err2, all) {
      var first = !err2 && all.MediaContainer.Metadata && all.MediaContainer.Metadata[0];
      if (!first) return send(res, 502, { error: 'no episodes' });
      play(first.ratingKey, 0);
    });
  });

  function play(key, offset) {
    getText('http://127.0.0.1:32500/resources', {}, function (err, xml) {
      if (err) return send(res, 503, { error: 'Plex app not answering yet: ' + err });
      var player = (/machineIdentifier="([^"]+)"/.exec(xml) || [])[1];
      if (!player) return send(res, 503, { error: 'no Plex player' });
      commandID += 1;
      getText('http://127.0.0.1:32500/player/playback/playMedia?key=' + encodeURIComponent('/library/metadata/' + key) +
        '&offset=' + offset + '&machineIdentifier=' + p.machineId + '&address=' + server.hostname +
        '&port=' + (server.port || 32400) + '&protocol=' + server.protocol.replace(':', '') + '&token=' + p.token +
        '&type=video&commandID=' + commandID,
        { 'X-Plex-Target-Client-Identifier': player, 'X-Plex-Client-Identifier': 'tv-home-bletchley-01' },
        function (err3) {
          if (err3) return send(res, 502, { error: 'Plex app said no: ' + err3 });
          send(res, 200, { ok: true });
        });
    });
  }
}

var PORT = 8093;
var FILE = '/home/owner/share/tv-home-config.json';
var config = null;
var icons = {};   // app id -> its icon file, from the last /apps

try { config = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}

function isLocal(req) {
  var a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function send(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function home(res) {
  var ha = config && config.homeAssistant;
  if (!ha) return send(res, 404, { error: 'Home Assistant not set up' });
  getJSON(ha.url + '/api/states', { Authorization: 'Bearer ' + ha.token }, function (err, states) {
      if (err) return send(res, 502, { error: String(err) });
      var people = [], devices = 0, mode = false, name = '';
      states.forEach(function (s) {
        // A person with no tracker (state unknown) isn't anyone to show.
        if (s.entity_id.indexOf('person.') === 0 && s.state !== 'unknown' && s.state !== 'unavailable') {
          var full = (s.attributes && s.attributes.friendly_name) || s.entity_id.slice(7);
          people.push({ name: full.split(' ')[0], home: s.state === 'home' });
        }
        if (s.entity_id === ha.guestsEntity) devices = parseInt(s.state, 10) || 0;
        if (s.entity_id === ha.guestModeEntity) mode = s.state === 'on';
        if (s.entity_id === ha.guestNameEntity && s.state !== 'unknown' && s.state !== 'unavailable') name = s.state;
      });
      send(res, 200, { people: people, guests: { mode: mode, name: name, devices: devices } });
  });
}

function trains(res) {
  var t = config && config.trains;
  if (!t || !t.enabled) return send(res, 404, { error: 'Trains not set up' });
  getJSON(t.url + t.from + '?numRows=10&filterCrs=' + t.to + '&filterType=to', { 'x-apikey': t.token }, function (err, b) {
      if (err) return send(res, 502, { error: String(err) });
      var departures = (b.trainServices || []).map(function (s) {
        var status = s.etd === 'On time' ? 'On time' : /^\d/.test(s.etd) ? 'Expected ' + s.etd : s.etd;
        return { time: s.std, status: status, late: s.etd !== 'On time' };
      });
      send(res, 200, { to: b.filterLocationName || t.to, departures: departures });
  });
}

http.createServer(function (req, res) {
  if (req.method === 'OPTIONS') return send(res, 204);
  var path = req.url.split('?')[0];

  if (path === '/config' && req.method === 'GET') {
    if (!isLocal(req)) return send(res, 403, { error: 'local only' });
    return send(res, 200, config || {});
  }
  if (path === '/config' && req.method === 'POST') {
    var body = '';
    req.on('data', function (c) { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', function () {
      var next;
      try { next = JSON.parse(body); } catch (e) { return send(res, 400, { error: 'not JSON' }); }
      if (!next || !next.tmdbKey) return send(res, 400, { error: 'missing tmdbKey' });
      config = next;
      var saved = true;
      try { fs.writeFileSync(FILE, JSON.stringify(config)); } catch (e) { saved = false; }
      send(res, 200, { ok: true, savedToFile: saved });
    });
    return;
  }
  if (path === '/ping') {
    var fileOk = true;
    try { fs.writeFileSync(FILE + '.test', '1'); fs.unlinkSync(FILE + '.test'); } catch (e) { fileOk = false; }
    return send(res, 200, { ok: true, node: process.version, fileOk: fileOk, hasConfig: !!config });
  }
  // The page can't use tizen.application inside TizenBrew; the service can.
  // Readable from the home network too: only app names and ids, for checking which app a tile opens.
  if (path === '/apps') {
    try {
      return tizen.application.getAppsInfo(function (list) {
        icons = {};
        list.forEach(function (a) { if (a.iconPath) icons[a.id] = a.iconPath.replace(/^file:\/\//, ''); });
        // Apps with no icon of their own all get Tizen's pinwheel: an icon that two apps share is that one.
        var hashes = {}, count = {};
        Object.keys(icons).forEach(function (id) {
          try { hashes[id] = crypto.createHash('md5').update(fs.readFileSync(icons[id])).digest('hex'); } catch (e) { return; }
          count[hashes[id]] = (count[hashes[id]] || 0) + 1;
        });
        send(res, 200, list.map(function (a) {
          return { id: a.id, name: a.name, show: a.show !== false, pkg: a.packageId, icon: !!icons[a.id] && !!hashes[a.id] && count[hashes[a.id]] === 1 };
        }));
      }, function (e) { send(res, 500, { error: String(e) }); });
    } catch (e) { return send(res, 500, { error: String(e) }); }
  }
  // An app's own icon, read from the TV (the page can't open file:// paths).
  if (path === '/icon' && isLocal(req)) {
    var file = icons[decodeURIComponent((req.url.split('id=')[1] || '').split('&')[0])];
    if (!file) return send(res, 404, { error: 'no icon' });
    return fs.readFile(file, function (err, data) {
      if (err) return send(res, 404, { error: 'no icon' });
      var ext = file.split('.').pop().toLowerCase();
      res.writeHead(200, {
        'Content-Type': ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=86400'
      });
      res.end(data);
    });
  }
  if (path === '/launch' && isLocal(req)) {
    return launch(decodeURIComponent((req.url.split('id=')[1] || '').split('&')[0]), res);
  }
  if (path === '/plexplay' && isLocal(req)) return plexPlay(req, res);
  if (path === '/home' && isLocal(req)) return home(res);
  if (path === '/trains' && isLocal(req)) return trains(res);
  send(res, 404, { error: 'not found' });
}).on('error', function (e) { console.log('TV Home service: ' + e); })
  .listen(PORT, '0.0.0.0');
