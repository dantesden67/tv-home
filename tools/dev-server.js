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

async function home(res) {
  const ha = settings().homeAssistant;
  if (!ha) return json(res, 404, { error: 'Home Assistant not set up' });
  try {
    const states = await (await fetch(ha.url + '/api/states', { headers: { Authorization: 'Bearer ' + ha.token } })).json();
    const people = states.filter((s) => s.entity_id.startsWith('person.'))
      .map((s) => ({ name: s.attributes.friendly_name || s.entity_id.slice(7), home: s.state === 'home' }));
    const g = ha.guestsEntity && states.find((s) => s.entity_id === ha.guestsEntity);
    json(res, 200, { people, guests: g ? parseInt(g.state, 10) || 0 : 0 });
  } catch (e) {
    json(res, 502, { error: String(e) });
  }
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/config') return json(res, 200, settings());
  if (url === '/home') return home(res);
  const file = path.normalize(path.join(APP, url === '/' ? 'index.html' : url));
  if (!file.startsWith(APP)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log('TV Home preview: http://localhost:' + PORT));
