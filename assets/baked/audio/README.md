# Baked audio

Nine clips, generated once on a developer machine with ElevenLabs, committed,
and loaded by the game as static files. **368 kB for the set**, against a 2 MB
budget.

Nothing in `src/` ever calls ElevenLabs. `ELEVENLABS_API_KEY` lives in `.env`,
is gitignored, is never added to Railway, and is read only by `tools/`. That is
D8, and it is what keeps the game playable offline with no keys in the bundle.

```bash
npx tsx tools/bake-audio/bake.ts --plan        # what it would spend, calls nothing
npx tsx tools/bake-audio/bake.ts               # anything missing or stale
npx tsx tools/bake-audio/bake.ts --force merge # regenerate one
npx tsx tools/bake-audio/measure.ts            # check the committed bytes, calls nothing
npx tsx tools/bake-audio/runtime.ts            # play them in a real browser and measure
```

## The files

MP3, `mp3_44100_64`, from `eleven_text_to_sound_v2`. One file per cue in
`src/audio/cues.ts`, named after it. The three beds were generated with
`loop: true`.

| File | Size | Length | Peak | Lift | What it is |
|---|---|---|---|---|---|
| `ambience.mp3` | 172 kB | 22.0s | 0.077 | 13.0x | leaves and grass in a breeze, the clearing bed |
| `fire.mp3` | 71 kB | 9.0s | 0.751 | 1.3x | one campfire, positional, one per burning thing |
| `water.mp3` | 71 kB | 9.0s | 0.131 | 7.6x | a stream over stones, placed from `region.places` |
| `merge.mp3` | 19 kB | 2.4s | 1.000 | 1.0x | grind, impact, decay. See below |
| `chop.mp3` | 10 kB | 1.3s | 0.872 | 1.1x | one axe blow into standing timber |
| `drop.mp3` | 7 kB | 0.8s | 0.363 | 2.8x | setting something down on earth |
| `step-grass.mp3` | 6 kB | 0.68s | 1.000 | 1.0x | one footfall on grass |
| `step-wood.mp3` | 6 kB | 0.68s | 0.683 | 1.5x | one footfall on a deck |
| `take.mp3` | 5 kB | 0.6s | 0.562 | 1.8x | picking something up |

`manifest.json` records the request hash, byte count and actual credit cost of
each, which is what makes a re-run free.

## Four things worth knowing before touching this

**Level is not something you can ask for.** The set came back with peaks
spanning 29 dB and the pattern was completely consistent: anything described as
a close physical event (an axe, a stamp on gravel, a fire) arrives near full
scale, and anything described as an environment arrives 20 to 40 dB down.
Asking for "a clear, even level" changed nothing. Asking for the same clearing
as "leaves and grass one metre from the microphone" moved it 16 dB. The
footstep went from 0.035 to 1.0 by being re-described as a boot stamping onto
straw and gravel rather than as a footstep on grass. Name the material, the
action and the distance. Never the volume.

**So level is fixed at runtime, not in the bytes.** `synth.normalise` scales
each decoded buffer up to full scale, capped at 16x, so a cue's gain in
`cues.ts` is a statement about the MIX and stays true whether the cue is playing
its baked file or its code-rendered placeholder. Re-baking one clip therefore
cannot silently change the balance of the game. The cap is what
`measure.ts` checks against: a clip needing more than 16x needs a better prompt,
not a bigger number.

**MP3 welds silence onto both ends.** The encoder delay and frame padding
measured between 0 and 426 ms across this set. Looping a file with that on it
gives a gap once per cycle, and playing a one-shot with it gives latency. The
runtime trims to the first and last audible sample (`synth.bounds`) and sets
`loopStart`/`loopEnd` and the one-shot start offset from that. Nothing is
re-encoded.

**The merge carries a rule.** Rule 3 says both inputs are destroyed permanently
and the loss has to be real, so this cue must not be a reward sound. It is
grind, then one heavy impact, then a low tone decaying to nothing, and there is
no rise anywhere in it. A sound-effects model asked about combining two items
returns a chime by default, which is why the prompt spends half its length
excluding one. `measure.ts` asserts the shape (loudest in the first half,
ending far quieter than it began) and `src/audio/synth.test.ts` asserts the same
shape on the placeholder, so a regenerated merge that has drifted into a jingle
fails a check rather than shipping.

## What is not checked

Whether any of it sounds good. `measure.ts` decodes the committed bytes and
reports duration, level, loop seam and shape; `runtime.ts` plays them through
the real mixer in a real browser and measures what comes out. Neither can hear.
The `fire` bed could have come back as rain and passed every number in this
directory. Somebody has to listen, exactly as `assets/baked/README.md` says
somebody has to look at the textures.

## Not baked yet

Music. There is a `music` bus in the mixer and nothing is on it. Per
`docs/ASSET_PIPELINE.md` that is one bed per band, which is a Band 1 to 3
question and there is only Band 0. The mill wheel also has no timber creak of
its own; it currently gets `water` at a larger radius.
