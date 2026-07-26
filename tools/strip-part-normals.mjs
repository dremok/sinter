#!/usr/bin/env node
/**
 * Drop the NORMAL attribute from `parts.glb`.
 *
 * `src/render/parts.ts` calls `geo.computeVertexNormals()` on every part as it
 * loads, and three's implementation either creates the normal attribute or
 * zeroes the existing one and recomputes it from the faces. Either way the
 * normals authored in Blender are overwritten before anything is drawn with
 * them, so shipping them is 45% of the file's bytes spent on data that is
 * discarded a few milliseconds after it arrives.
 *
 * This is therefore not a quality trade. The loaded geometry is bit-identical
 * with or without them, which the byte-identical screenshot check proves.
 *
 * The real home for the fix is the Blender export in `tools/blender/`. This
 * exists so the saving can be measured and proven against the parts file that
 * is actually checked in, without a Blender round trip.
 *
 *   node tools/strip-part-normals.mjs [in.glb] [out.glb]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const inPath = resolve(process.argv[2] ?? 'assets/parts/parts.glb')
const outPath = resolve(process.argv[3] ?? inPath)

const buf = readFileSync(inPath)
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${inPath} is not a GLB`)

let offset = 12
let json = null
let bin = null
while (offset < buf.readUInt32LE(8)) {
  const len = buf.readUInt32LE(offset)
  const type = buf.readUInt32LE(offset + 4)
  const body = buf.subarray(offset + 8, offset + 8 + len)
  if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'))
  if (type === 0x004e4942) bin = body
  offset += 8 + len + ((4 - (len % 4)) % 4)
}
if (!json || !bin) throw new Error('GLB is missing a JSON or BIN chunk')

let dropped = 0
for (const mesh of json.meshes ?? []) {
  for (const prim of mesh.primitives ?? []) {
    if (prim.attributes?.NORMAL !== undefined) {
      delete prim.attributes.NORMAL
      dropped++
    }
  }
}

// Anything still pointed at by an accessor that anything still points at. Only
// mesh primitives reference accessors in this file (the report tool confirms no
// bufferView bytes go unclaimed), so this walk is complete.
const liveAccessors = new Set()
for (const mesh of json.meshes ?? []) {
  for (const prim of mesh.primitives ?? []) {
    for (const a of Object.values(prim.attributes ?? {})) liveAccessors.add(a)
    if (prim.indices !== undefined) liveAccessors.add(prim.indices)
    for (const t of prim.targets ?? []) for (const a of Object.values(t)) liveAccessors.add(a)
  }
}
for (const skin of json.skins ?? []) {
  if (skin.inverseBindMatrices !== undefined) liveAccessors.add(skin.inverseBindMatrices)
}
for (const anim of json.animations ?? []) {
  for (const s of anim.samplers ?? []) {
    liveAccessors.add(s.input)
    liveAccessors.add(s.output)
  }
}

// Repack the BIN in accessor order, four-byte aligned as the spec requires.
const oldAccessors = json.accessors ?? []
const oldViews = json.bufferViews ?? []
const newAccessors = []
const newViews = []
const accessorMap = new Map()
const chunks = []
let binLength = 0

for (let i = 0; i < oldAccessors.length; i++) {
  if (!liveAccessors.has(i)) continue
  const acc = { ...oldAccessors[i] }
  const view = oldViews[acc.bufferView]
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const slice = bin.subarray(start, start + view.byteLength - (acc.byteOffset ?? 0))

  const pad = (4 - (binLength % 4)) % 4
  if (pad) {
    chunks.push(Buffer.alloc(pad))
    binLength += pad
  }
  const newView = { buffer: 0, byteOffset: binLength, byteLength: slice.length }
  if (view.target !== undefined) newView.target = view.target
  chunks.push(slice)
  binLength += slice.length

  acc.bufferView = newViews.length
  delete acc.byteOffset
  newViews.push(newView)
  accessorMap.set(i, newAccessors.length)
  newAccessors.push(acc)
}

for (const mesh of json.meshes ?? []) {
  for (const prim of mesh.primitives ?? []) {
    for (const [k, v] of Object.entries(prim.attributes ?? {})) prim.attributes[k] = accessorMap.get(v)
    if (prim.indices !== undefined) prim.indices = accessorMap.get(prim.indices)
  }
}

json.accessors = newAccessors
json.bufferViews = newViews
json.buffers = [{ byteLength: binLength }]

let binChunk = Buffer.concat(chunks)
const binPad = (4 - (binChunk.length % 4)) % 4
if (binPad) binChunk = Buffer.concat([binChunk, Buffer.alloc(binPad)])

let jsonChunk = Buffer.from(JSON.stringify(json), 'utf8')
const jsonPad = (4 - (jsonChunk.length % 4)) % 4
if (jsonPad) jsonChunk = Buffer.concat([jsonChunk, Buffer.alloc(jsonPad, 0x20)])

const header = Buffer.alloc(12)
header.write('glTF', 0, 'ascii')
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8)

const chunkHeader = (len, type) => {
  const b = Buffer.alloc(8)
  b.writeUInt32LE(len, 0)
  b.writeUInt32LE(type, 4)
  return b
}

const out = Buffer.concat([
  header,
  chunkHeader(jsonChunk.length, 0x4e4f534a),
  jsonChunk,
  chunkHeader(binChunk.length, 0x004e4942),
  binChunk,
])

writeFileSync(outPath, out)
console.log(
  `${inPath} -> ${outPath}\n` +
    `dropped NORMAL from ${dropped} primitives\n` +
    `${(buf.length / 1024).toFixed(1)} kB -> ${(out.length / 1024).toFixed(1)} kB  ` +
    `(${(((buf.length - out.length) / buf.length) * 100).toFixed(1)}% smaller)`,
)
