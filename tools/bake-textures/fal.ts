/**
 * A minimal fal.ai queue client over `fetch`, plus a `.env` reader.
 *
 * No `@fal-ai/client`, for the same reason there is no `sharp`: the whole
 * surface used here is one POST and two GETs, and the repo's standing rule is
 * that a dependency needs a written justification. `npm audit` currently reports
 * zero vulnerabilities (D8) and this tool is not the thing that changes that.
 *
 * The queue endpoints are used rather than the synchronous `fal.run` ones
 * because a tiling material generation can outlive a default HTTP timeout, and
 * a request that times out client-side has still been billed.
 *
 * FAL_KEY is read from `.env` and is never logged. The only thing this module
 * ever prints about it is whether it was found.
 */

import { readFileSync } from 'node:fs'

const QUEUE = 'https://queue.fal.run'

export function readEnvFile(path: string): Record<string, string> {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return {}
  }
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) out[key] = value
  }
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface FalImage {
  url: string
  width?: number
  height?: number
  map_type?: string
}

export interface FalResult {
  images?: FalImage[]
  seed?: number
  prompt?: string
}

/**
 * Submit, poll, fetch. Polling is deliberately dumb: a fixed interval and a
 * hard ceiling, because the alternative is an exponential backoff that turns a
 * stuck request into a five minute silence.
 */
export async function run(
  key: string,
  model: string,
  input: Record<string, unknown>,
  opts: { timeoutMs?: number; onWait?: (seconds: number) => void } = {},
): Promise<FalResult> {
  const headers = {
    Authorization: `Key ${key}`,
    'Content-Type': 'application/json',
  }

  const submit = await fetch(`${QUEUE}/${model}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  })
  if (!submit.ok) {
    throw new Error(`fal submit ${submit.status}: ${redact(await submit.text(), key)}`)
  }
  const queued = (await submit.json()) as { request_id: string; status_url?: string; response_url?: string }
  const id = queued.request_id
  // The model id in a status URL drops any trailing path segment, e.g.
  // `fal-ai/patina/material` is queued under `fal-ai/patina`. Trust the URLs
  // the API hands back rather than reconstructing them.
  const statusUrl = queued.status_url ?? `${QUEUE}/${model}/requests/${id}/status`
  const responseUrl = queued.response_url ?? `${QUEUE}/${model}/requests/${id}`

  const deadline = Date.now() + (opts.timeoutMs ?? 300_000)
  const started = Date.now()
  for (;;) {
    await sleep(2000)
    const res = await fetch(statusUrl, { headers })
    if (!res.ok) throw new Error(`fal status ${res.status}: ${redact(await res.text(), key)}`)
    const status = (await res.json()) as { status: string; logs?: unknown }
    if (status.status === 'COMPLETED') break
    if (status.status !== 'IN_QUEUE' && status.status !== 'IN_PROGRESS') {
      throw new Error(`fal returned status ${status.status}`)
    }
    opts.onWait?.(Math.round((Date.now() - started) / 1000))
    if (Date.now() > deadline) throw new Error('fal request timed out')
  }

  const out = await fetch(responseUrl, { headers })
  if (!out.ok) throw new Error(`fal result ${out.status}: ${redact(await out.text(), key)}`)
  return (await out.json()) as FalResult
}

export async function download(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${res.status} for ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** Belt and braces: an error body should never be able to echo the key back. */
function redact(text: string, key: string): string {
  return text.split(key).join('[FAL_KEY]').slice(0, 400)
}
