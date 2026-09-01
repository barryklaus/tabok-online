# TABOK TURN relay setup

This Worker gives the public GitHub Pages game short-lived Cloudflare Realtime
TURN credentials. The permanent TURN key stays encrypted inside Cloudflare and
is never shipped with the game.

## 1. Create the TURN key

In the Cloudflare dashboard, open **Realtime → TURN** and create a TURN key.
Keep both values private:

- TURN key ID
- TURN key API token

## 2. Deploy this Worker

Copy `wrangler.toml.example` to `wrangler.toml`. Its `ALLOWED_ORIGINS` value
should be the website origin only, without a path. For the current GitHub Pages
site that is `https://barryklaus.github.io`.

From this `turn-relay` folder, deploy with Wrangler:

```sh
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
npx wrangler deploy
```

Paste each private value only when Wrangler asks for it. Do not write either
secret into `worker.js`, `wrangler.toml`, `network-config.js`, GitHub, or chat.

Cloudflare returns an HTTPS `workers.dev` URL after deployment. The endpoint
accepts credential requests only from the configured website origin; opening it
directly may therefore show an origin error. The game performs the proper test.

## 3. Connect the game

Open the public `network-config.js` beside TABOK's `index.html` and set:

```js
window.TABOK_NETWORK = Object.freeze({
  turnCredentialEndpoint: 'https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev'
});
```

Upload the full game folder to GitHub Pages. The lobby will report **TURN relay
ready** when credentials were obtained. If the Worker is unavailable, TABOK
keeps working in direct-only mode and explains that the relay fallback failed.

## Security and operation

- Credentials expire after 24 hours and are requested again on a new page load.
- The Worker removes port 53 routes because browsers commonly block them.
- Restrict `ALLOWED_ORIGINS` to the production site.
- Configure a Cloudflare rate-limiting rule for the Worker before public launch.
- Monitor Cloudflare Realtime TURN usage and rotate the TURN key if abuse is
  suspected.
