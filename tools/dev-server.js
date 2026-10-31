// Preview on this PC: serves the app at http://localhost:5178 and answers as the TV's service would.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { settings } = require('./settings');

const PORT = 5178;
const APP = path.join(__dirname, '..', 'app');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Same answers as service/service.js gives on the TV.
async function home(res) {
  const ha = settings().homeAssistant;
  if (!ha) return json(res, 404, { error: 'Home Assistant not set up' });
  try {
    const states = await (await fetch(ha.url + '/api/states', { headers: { Authorization: 'Bearer ' + ha.token } })).json();
    const people = states.filter((s) => s.entity_id.startsWith('person.') && s.state !== 'unknown' && s.state !== 'unavailable')
      .map((s) => ({ name: (s.attributes.friendly_name || s.entity_id.slice(7)).split(' ')[0], home: s.state === 'home' }));
    const state = (id) => { const s = id && states.find((x) => x.entity_id === id); return s ? s.state : null; };
    const name = state(ha.guestNameEntity);
    json(res, 200, { people, guests: {
      mode: state(ha.guestModeEntity) === 'on',
      name: name && name !== 'unknown' && name !== 'unavailable' ? name : '',
      devices: parseInt(state(ha.guestsEntity), 10) || 0
    } });
  } catch (e) {
    json(res, 502, { error: String(e) });
  }
}

async function trains(res) {
  const t = settings().trains;
  if (!t.enabled) return json(res, 404, { error: 'Trains not set up' });
  try {
    const r = await fetch(t.url + t.from + '?numRows=10', { headers: { 'x-apikey': t.token } });
    if (!r.ok) return json(res, 502, { error: 'National Rail ' + r.status });
    const b = await r.json();
    let name = t.to;
    const departures = [];
    for (const s of b.trainServices || []) {
      const stop = [].concat(...(s.subsequentCallingPoints || []).map((l) => l.callingPoint || [])).find((c) => c.crs === t.to);
      if (!stop) continue;
      name = stop.locationName || name;
      departures.push({
        time: s.std,
        status: s.isCancelled || s.etd === 'Cancelled' ? 'Cancelled' : s.etd === 'On time' ? 'On time' : /^\d/.test(s.etd) ? 'Expected ' + s.etd : s.etd,
        late: s.etd !== 'On time', arrive: stop.st, platform: s.platform || null
      });
    }
    json(res, 200, { to: name, departures });
  } catch (e) {
    json(res, 502, { error: String(e) });
  }
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/config') return json(res, 200, settings());
  if (url === '/home') return home(res);
  if (url === '/trains') return trains(res);
  const file = path.normalize(path.join(APP, url === '/' ? 'index.html' : url));
  if (!file.startsWith(APP)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log('TV Home preview: http://localhost:' + PORT));
