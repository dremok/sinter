/**
 * A minimal ElevenLabs sound-effects client over `fetch`.
 *
 * No `@elevenlabs/elevenlabs-js`, for the reason `bake-textures/fal.ts` gives
 * for not taking the fal client: the entire surface used here is one POST that
 * returns an MP3, the repo's standing rule is that a dependency needs a written
 * justification, and `npm audit` currently reports zero vulnerabilities (D8).
 *
 * ELEVENLABS_API_KEY is read from `.env` and is never logged. Error bodies are
 * passed through a redactor before they are printed, because an API that echoes
 * a request back is an API that can print your key into a terminal log.
 *
 * Nothing under `src/` imports this file, and nothing under `src/` ever will:
 * the shipped game makes no network calls and needs no keys.
 */

const ENDPOINT = 'https://api.elevenlabs.io/v1/sound-generation'

export interface SoundRequest {
  text: string
  model_id: string
  duration_seconds: number
  prompt_influence: number
  loop?: boolean
}

export interface SoundResult {
  bytes: Uint8Array
  /** What the request actually cost, straight from the response header. */
  characterCost: number | null
}

/**
 * One generation.
 *
 * Synchronous rather than queued, unlike the fal client: sound generation of up
 * to thirty seconds comes back in a few seconds and there is no queue API to
 * poll. The timeout is generous and explicit, because a request that times out
 * client-side has still been billed.
 */
export async function generate(
  key: string,
  request: SoundRequest,
  outputFormat: string,
  timeoutMs = 180_000,
): Promise<SoundResult> {
  const url = `${ENDPOINT}?output_format=${encodeURIComponent(outputFormat)}`
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(request),
      signal: abort.signal,
    })

    if (!res.ok) {
      throw new Error(`elevenlabs ${res.status}: ${redact(await res.text(), key)}`)
    }

    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length === 0) throw new Error('elevenlabs returned an empty body')

    const header = res.headers.get('character-cost')
    return { bytes, characterCost: header ? Number(header) : null }
  } finally {
    clearTimeout(timer)
  }
}

/** An error body must never be able to echo the key back into a log. */
function redact(text: string, key: string): string {
  return text.split(key).join('[ELEVENLABS_API_KEY]').slice(0, 400)
}

/**
 * Is this actually an MP3?
 *
 * Cheap, and worth doing: an API that returns JSON with a 200 would otherwise
 * be committed as a `.mp3` full of an error message, and the first anyone would
 * know is a decode failure in a browser weeks later. An MP3 starts with either
 * an ID3 tag or an MPEG frame sync.
 */
export function looksLikeMp3(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33
  const sync = bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0
  return id3 || sync
}
