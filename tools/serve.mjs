/**
 * Zero dependency static server for the production build.
 *
 * Deliberately not the `serve` package: it pulls in a transitive high severity
 * brace-expansion advisory, and `npm audit fix --force` "resolves" that by
 * downgrading to a years old major version. For serving one directory of
 * static files, forty lines with no supply chain is the better trade.
 *
 * Also lets us set application/wasm explicitly, which matters the moment
 * anything ships a real .wasm file rather than an inlined one.
 *
 *   node tools/serve.mjs           # PORT or 3000
 */

import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, extname, normalize, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', 'dist')
const PORT = Number(process.env.PORT ?? 3000)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
}

async function resolveFile(urlPath) {
  // Strip query/hash, decode, and normalize away any ../ before joining.
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0].split('#')[0]))
  const candidate = join(ROOT, clean)
  if (!candidate.startsWith(ROOT)) return null // traversal attempt

  try {
    const s = await stat(candidate)
    if (s.isFile()) return candidate
    if (s.isDirectory()) {
      const index = join(candidate, 'index.html')
      if ((await stat(index)).isFile()) return index
    }
  } catch {
    /* fall through to SPA fallback */
  }
  return null
}

const server = createServer(async (req, res) => {
  const file = (await resolveFile(req.url ?? '/')) ?? join(ROOT, 'index.html')
  const ext = extname(file)

  try {
    await stat(file)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }

  // Vite fingerprints everything under /assets/, so those are safe to pin.
  // index.html must never be cached or clients get stuck on a stale build.
  const immutable = file.includes(`${ROOT}/assets/`)
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
})

server.listen(PORT, () => console.log(`sinter serving ${ROOT} on :${PORT}`))
