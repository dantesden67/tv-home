// Sends the settings to the TV's TV Home service (the app must have been opened once, so the service is running).
const { settings } = require('./settings');

const s = settings();
const tv = process.argv[2] || (s.tv && s.tv.ip);
if (!tv) { console.error('Usage: node tools/push-config.js <TV IP>'); process.exit(1); }

fetch('http://' + tv + ':8093/config', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(s)
})
  .then(async (r) => {
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.status);
    console.log('Sent to ' + tv + (body.savedToFile ? '' : ' (kept in memory only: reopen the app on the TV to keep it)'));
  })
  .catch((e) => { console.error("Couldn't reach TV Home on " + tv + ': ' + e.message); process.exit(1); });
