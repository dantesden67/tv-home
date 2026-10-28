/*
 * TV Home's service: TizenBrew runs it on the TV next to the app. Plain ES5, as older TVs run an old Node.
 *  - GET  /config  the app's settings, to the app only (127.0.0.1)
 *  - POST /config  the settings, sent once from the PC (tools/push-config.js); kept in a file on the TV
 *  - GET  /home    who's home, from Home Assistant (the app can't call it directly: CORS)
 *  - GET  /trains  the next departures, from National Rail (CORS again, and the key stays out of the page)
 * The settings hold keys, so they never go in the published module.
 */
var http = require('http');
var fs = require('fs');
var fetch = require('node-fetch');

var PORT = 8093;
var FILE = '/home/owner/share/tv-home-config.json';
var config = null;

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
  fetch(ha.url + '/api/states', { headers: { Authorization: 'Bearer ' + ha.token } })
    .then(function (r) { return r.json(); })
    .then(function (states) {
      var people = [], guests = 0;
      states.forEach(function (s) {
        // A person with no tracker (state unknown) isn't anyone to show.
        if (s.entity_id.indexOf('person.') === 0 && s.state !== 'unknown' && s.state !== 'unavailable') {
          var name = (s.attributes && s.attributes.friendly_name) || s.entity_id.slice(7);
          people.push({ name: name.split(' ')[0], home: s.state === 'home' });
        }
        if (ha.guestsEntity && s.entity_id === ha.guestsEntity) guests = parseInt(s.state, 10) || 0;
      });
      send(res, 200, { people: people, guests: guests });
    })
    .catch(function (e) { send(res, 502, { error: String(e) }); });
}

function trains(res) {
  var t = config && config.trains;
  if (!t || !t.enabled) return send(res, 404, { error: 'Trains not set up' });
  fetch(t.url + t.from + '?numRows=10&filterCrs=' + t.to + '&filterType=to', { headers: { 'x-apikey': t.token } })
    .then(function (r) {
      if (!r.ok) throw new Error('National Rail ' + r.status);
      return r.json();
    })
    .then(function (b) {
      var departures = (b.trainServices || []).map(function (s) {
        var status = s.etd === 'On time' ? 'On time' : /^\d/.test(s.etd) ? 'Expected ' + s.etd : s.etd;
        return { time: s.std, status: status, late: s.etd !== 'On time' };
      });
      send(res, 200, { to: b.filterLocationName || t.to, departures: departures });
    })
    .catch(function (e) { send(res, 502, { error: String(e) }); });
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
  if (path === '/home' && isLocal(req)) return home(res);
  if (path === '/trains' && isLocal(req)) return trains(res);
  send(res, 404, { error: 'not found' });
}).listen(PORT, '0.0.0.0');
