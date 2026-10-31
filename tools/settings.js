// The app's settings, put together from config.json and the token files beside it (none of them published).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8').trim();
// A key not made yet leaves its part of the screen off.
const maybe = (name) => { try { return name ? read(name) : null; } catch (e) { return null; } };

const RAIL = 'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepBoardWithDetails/';

function settings() {
  const c = JSON.parse(read('config.json'));
  const haToken = c.homeAssistant && maybe(c.homeAssistant.tokenFile);
  const railToken = c.trains && maybe(c.trains.tokenFile);
  return {
    tmdbKey: c.tmdbKey,
    region: c.tmdbRegion || 'GB',
    language: c.language || 'en-GB',
    place: c.place,
    services: c.services,
    plex: c.plex ? { url: c.plex.url, token: read(c.plex.tokenFile), libraries: c.plex.libraries, machineId: c.plex.machineId } : null,
    jellyfin: c.jellyfin ? { url: c.jellyfin.url, userId: c.jellyfin.userId, token: read(c.jellyfin.tokenFile) } : null,
    homeAssistant: haToken ? {
      url: c.homeAssistant.url, token: haToken,
      guestsEntity: c.homeAssistant.guestsEntity || null,
      guestModeEntity: c.homeAssistant.guestModeEntity || null,
      guestNameEntity: c.homeAssistant.guestNameEntity || null
    } : null,
    trains: railToken
      ? { enabled: true, from: c.trains.from, to: c.trains.to, count: c.trains.count || 3, token: railToken, url: c.trains.url || RAIL }
      : { enabled: false },
    tv: c.tv
  };
}

module.exports = { settings };
