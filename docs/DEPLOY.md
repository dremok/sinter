# SINTER: Deploying to Railway

The game is a fully static build. `vite build` emits `dist/`, and a static file server serves it. There is no backend, no database, and no runtime API keys, because all asset generation happens offline and gets committed.

## How it is wired

[`railway.json`](../railway.json) at the repo root configures everything:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "RAILPACK",
    "buildCommand": "npm run build"
  },
  "deploy": {
    "startCommand": "node tools/serve.mjs",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

Three things worth understanding rather than copying blindly:

- **Railpack is Railway's current default builder**, having replaced Nixpacks. It has first class support for Vite static sites, so it detects this project correctly without extra configuration.
- **Railway does not serve static files on its own.** Something has to actually listen on `$PORT`.
- **That something is `tools/serve.mjs`, deliberately hand written with zero dependencies.** Railway's own docs suggest the `serve` package, and that was the original approach here, but `serve` pulls in a transitive high severity `brace-expansion` DoS advisory, and `npm audit fix --force` "fixes" it by downgrading `serve` to a years old major version. For serving one directory of static files, forty lines of `node:http` is the better trade. It also sets `application/wasm` explicitly, reads `PORT` from the environment, falls back to `index.html` for SPA routes, rejects path traversal, and marks Vite's fingerprinted `/assets/` immutable while keeping `index.html` uncached.

`npm audit` currently reports zero vulnerabilities. Keep it that way; if a dependency is worth a high severity advisory, it is usually worth replacing instead.

## First deploy

```bash
npm i -g @railway/cli     # if not already installed
railway login
railway init              # creates the project, or `railway link` to attach to an existing one
railway up                # build and deploy
railway domain            # generate a public URL
```

After the first deploy, connect the GitHub repo in the Railway dashboard so pushes to `main` deploy automatically. At that point `railway up` is only needed for out of band deploys.

## Verify a deploy

Do not assume a green build means a working game. WebGL and WASM both fail in ways a successful build will not catch.

```bash
npm run verify:deploy     # loads the live site in a real browser, exits non-zero on any error
npm run verify:deploy -- https://some-preview.up.railway.app/
railway logs              # build and runtime output
railway open              # open the deployed site
```

`tools/verify-deploy.mjs` drives the live animation loop rather than the headless single-frame path, waits three seconds, and then checks that a canvas exists and that the tick counter has actually advanced. A single frame would pass even if the simulation threw on its second tick. It fails on any page error, console error, or failed request, and writes `.shots/deployed.png` so you can look at what the server is really serving.

Expect a low fps number from it. It runs headless on SwiftShader software rendering, so 10 fps there is normal and says nothing about a real machine.

**Live at https://sinter-production.up.railway.app** (project `sinter`, first deployed 2026-07-25).

## Environment variables

The deployed game needs **none**. It runs entirely offline in the browser.

`FAL_KEY` and `ELEVENLABS_API_KEY` are only used by the offline asset bake in `tools/`, which runs on a developer machine and commits its output. Max keeps them in `~/code/oubli-forever/.env`. Do not add them to Railway, do not commit them, and do not read them into anything under `src/`.

## Gotchas

- **Build memory.** Railway's default build container is not large. If `vite build` gets OOM killed once the asset catalog grows, raise the memory limit on the service rather than trimming assets reflexively.
- **Asset size.** Baked textures and audio are committed, so the repo and the build both grow over time. This is the most likely future cause of slow deploys.
- **`tsc --noEmit` runs as part of `npm run build`.** A type error fails the deploy, which is intentional. Do not weaken this to get a deploy out.
- **Rapier prints a deprecation warning on init** ("using deprecated parameters for the initialization function"). It comes from inside `@dimforge/rapier3d-compat` 0.19.3, which passes a `Uint8Array` to its own wasm loader. It is harmless and there is no call site to change. Do not spend time on it.
