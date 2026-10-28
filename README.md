# TV Home

A calm home screen for a Samsung TV, run as a [TizenBrew](https://github.com/reisxd/TizenBrew) app module:
a featured pick from your streaming services and your own Plex and Jellyfin servers, Continue watching,
weather, trains and who's home.

No keys or server addresses are in this repository. They live in `config.json` and `*-token.txt` on your own
computer (ignored by git) and are sent to the TV once over the home network.

## Use

1. In TizenBrew on the TV: Module Manager → Add GitHub module → `<your GitHub name>/tv-home@main` (with `@main`, so updates arrive within minutes). Open it once.
2. On your computer: `node tools/push-config.js` sends the settings to the TV.

## Preview on a computer

`node tools/dev-server.js`, then open http://localhost:5178 (arrow keys and Enter act as the remote).

