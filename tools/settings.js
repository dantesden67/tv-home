// The app's settings, put together from config.json and the token files beside it (none of them published).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8').trim();

function settings() {
  const c = JSON.parse(read('config.json'));
  return {
    tmdbKey: c.tmdbKey,
    region: c.tmdbRegion || 'GB',
    language: c.language || 'en-GB',
    place: c.place,
    services: c.services,
    plex: c.plex ? { url: c.plex.url, token: read(c.plex.tokenFile), libraries: c.plex.libraries } : null,
    jellyfin: c.jellyfin ? { url: c.jellyfin.url, userId: c.jellyfin.userId, token: read(c.jellyfin.tokenFile) } : null,
    homeAssistant: c.homeAssistant
      ? { url: c.homeAssistant.url, token: read(c.homeAssistant.tokenFile), guestsEntity: c.homeAssistant.guestsEntity || null }
      : null,
    trains: c.trains && c.trains.tokenFile ? { enabled: true, count: c.trains.count || 3 } : { enabled: false },
    tv: c.tv
  };
}

module.exports = { settings };
