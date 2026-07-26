#!/usr/bin/env node
/**
 * What is actually inside `assets/parts/parts.glb`.
 *
 * The parts library has a 400 kB budget in `docs/PERFORMANCE.md` and is over it,
 * and "make the glb smaller" is not an actionable instruction without knowing
 * which part is heavy and why. This prints per-part triangles, vertices, the
 * attributes each primitive carries, and the bytes each one is responsible for,
 * so the next decision is about a named part rather than about a total.
 *
 * Reads the container directly rather than through a loader: a GLB is a 12-byte
 * header plus length-prefixed chunks, and the JSON chunk already holds every
 * count needed. No three, no GLTFLoader, no DOM.
 *
 *   node tools/parts-report.mjs [path/to/file.glb]
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const path = resolve(process.argv[2] ?? 'assets/parts/parts.glb')
const buf = readFileSync(path)

if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`)
const total = buf.readUInt32LE(8)

let offset = 12
let json = null
let binLength = 0
while (offset < total) {
  const len = buf.readUInt32LE(offset)
  const type = buf.readUInt32LE(offset + 4)
  const body = buf.subarray(offset + 8, offset + 8 + len)
  if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'))
  if (type === 0x004e4942) binLength = len
  offset += 8 + len + ((4 - (len % 4)) % 4)
}
if (!json) throw new Error('no JSON chunk')

const accessors = json.accessors ?? []
const views = json.bufferViews ?? []

/** Bytes a bufferView occupies, counted once per part even if shared. */
const viewBytes = (i) => views[i]?.byteLength ?? 0

const rows = []
for (const [i, mesh] of (json.meshes ?? []).entries()) {
  let tris = 0
  let verts = 0
  let bytes = 0
  const seen = new Set()
  const attrs = new Set()

  for (const prim of mesh.primitives ?? []) {
    const pos = accessors[prim.attributes?.POSITION]
    const idx = prim.indices !== undefined ? accessors[prim.indices] : null
    verts += pos?.count ?? 0
    tris += idx ? idx.count / 3 : (pos?.count ?? 0) / 3

    for (const [name, a] of Object.entries(prim.attributes ?? {})) {
      attrs.add(name)
      const v = accessors[a]?.bufferView
      if (v !== undefined && !seen.has(v)) {
        seen.add(v)
        bytes += viewBytes(v)
      }
    }
    const v = idx?.bufferView
    if (v !== undefined && !seen.has(v)) {
      seen.add(v)
      bytes += viewBytes(v)
    }
  }

  rows.push({
    name: mesh.name ?? `mesh${i}`,
    tris,
    verts,
    bytes,
    prims: (mesh.primitives ?? []).length,
    attrs: [...attrs].sort().join('+'),
  })
}

rows.sort((a, b) => b.bytes - a.bytes)

const sum = (k) => rows.reduce((n, r) => n + r[k], 0)
const kb = (n) => (n / 1024).toFixed(1).padStart(7)

console.log(`${path}`)
console.log(
  `file ${(buf.length / 1024).toFixed(1)} kB   bin chunk ${(binLength / 1024).toFixed(1)} kB   ` +
    `json ${((buf.length - binLength - 20) / 1024).toFixed(1)} kB   ` +
    `${rows.length} meshes, ${sum('tris')} tris, ${sum('verts')} verts`,
)
console.log(
  `accessors ${accessors.length}  bufferViews ${views.length}  ` +
    `materials ${(json.materials ?? []).length}  nodes ${(json.nodes ?? []).length}  ` +
    `images ${(json.images ?? []).length}`,
)
console.log()
console.log('     kB    tris   verts  prims  attributes            part')
for (const r of rows) {
  console.log(
    `${kb(r.bytes)}  ${String(r.tris).padStart(6)}  ${String(r.verts).padStart(6)}  ` +
      `${String(r.prims).padStart(5)}  ${r.attrs.padEnd(20)}  ${r.name}`,
  )
}

// Bytes not attributable to any mesh primitive: animation, morph targets,
// inverse bind matrices, or padding. Large here means the fat is not geometry.
const claimed = new Set()
for (const mesh of json.meshes ?? []) {
  for (const prim of mesh.primitives ?? []) {
    for (const a of Object.values(prim.attributes ?? {})) {
      const v = accessors[a]?.bufferView
      if (v !== undefined) claimed.add(v)
    }
    const v = prim.indices !== undefined ? accessors[prim.indices]?.bufferView : undefined
    if (v !== undefined) claimed.add(v)
  }
}
let unclaimed = 0
for (let i = 0; i < views.length; i++) if (!claimed.has(i)) unclaimed += viewBytes(i)
console.log()
console.log(`bufferView bytes not used by any mesh primitive: ${(unclaimed / 1024).toFixed(1)} kB`)
