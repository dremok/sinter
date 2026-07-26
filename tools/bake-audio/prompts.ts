/**
 * What each cue is asked for, and why it is asked for that.
 *
 * Kept apart from the bake for the same reason `bake-textures/prompts.ts` is:
 * the prompts are the design, and the script around them is plumbing. Changing
 * a prompt invalidates that cue's cache and costs money; changing the script
 * costs nothing.
 *
 * House style for these, learned from the texture bake: name the material, name
 * the distance, name the environment, and say what must NOT be in it. A sound
 * effects model will happily add music, reverb and a second event, and every
 * one of those makes a clip unusable as a game cue.
 */

/** Bumped when the request shape changes in a way that should re-bake. */
export const PIPELINE_VERSION = 1

/** Default and current sound model. `loop` needs v2. */
export const MODEL = 'eleven_text_to_sound_v2'

/**
 * 64 kbps mono-ish MP3 at 44.1 kHz.
 *
 * The budget is 2 MB for the whole set (the brief) and the repo already warns
 * that baked assets accumulate. At 64 kbps a 22 second bed is 176 kB, which
 * leaves room for everything else twice over. Above this the files get bigger
 * without getting more legible through a game mix; below it the fire bed starts
 * to sound like rain.
 */
export const FORMAT = 'mp3_44100_64'

export interface SoundSpec {
  /** Matches a CueId in `src/audio/cues.ts`. The file is written as `<id>.mp3`. */
  id: string
  prompt: string
  /** Seconds. 0.5 to 30, and the whole cost: 11 credits per second. */
  seconds: number
  /** Ask the model for a seamless loop. Only meaningful on v2. */
  loop?: boolean
  /** 0 to 1. Higher follows the prompt and reduces variety. */
  influence: number
  /** Why this cue sounds the way it does. Not sent to the model. */
  note: string
}

export const SPECS: SoundSpec[] = [
  {
    id: 'ambience',
    seconds: 22,
    loop: true,
    influence: 0.3,
    prompt:
      'Dry oak leaves and long grass rustling in a steady breeze, recorded loudly from one metre ' +
      'away with the microphone among the foliage. Full, close and continuous, filling the whole ' +
      'recording from start to finish, with a few small birds nearby. No silence, no fades, no ' +
      'sudden events. No music, no voices, no footsteps, no water.',
    note:
      'The bed a player hears for their entire session, so the failure mode to avoid is not ' +
      'blandness, it is anything with a shape you can learn. A bird call every eight seconds ' +
      'becomes a metronome by the second hour. Water is excluded because the brook and the mill ' +
      'are positional and would double up. ' +
      'Level took three attempts and the lesson generalises. Asking for a "quiet clearing, ' +
      'nothing close to the microphone" returned exactly that, peaking at 0.005 (46 dB down). ' +
      'Asking the same thing "recorded at a clear, even level" moved it to 0.013, which is ' +
      'nothing. What worked was changing the CATEGORY: every clip that came back hot was a close, ' +
      'physical event (fire, an axe, a footstep on wood) and every clip that came back dead was ' +
      'described as an environment. So this asks for leaves and grass one metre from the ' +
      'microphone rather than for a clearing. Name the material and the distance, never the ' +
      'volume; volume is decided in `cues.ts` and normalised in `synth.normalise`.',
  },
  {
    id: 'fire',
    seconds: 9,
    loop: true,
    influence: 0.4,
    prompt:
      'A small campfire burning close by. A continuous low roar of flame with irregular sharp ' +
      'crackles and pops of dry wood, and the occasional hiss of sap. Close, dry, outdoors. ' +
      'No music, no wind, no voices, no crowd.',
    note:
      'One of these plays per burning thing and the palisade can have seventeen alight at once, ' +
      'so it has to sit still in the mix. Irregular crackle matters more than volume: seventeen ' +
      'copies of a regular pattern phase against each other and turn into a drum machine.',
  },
  {
    id: 'water',
    seconds: 9,
    loop: true,
    influence: 0.4,
    prompt:
      'A shallow stream running over stones, heard from the bank a couple of paces away. ' +
      'Continuous soft rushing water with light trickling and gurgling. ' +
      'No music, no birds, no wind, no waves, no rain.',
    note:
      'Placed at the region\'s water places and, loudest, at the mill. It is also the only sound ' +
      'in the game a player can walk toward, so it has to stay legible at low volume from a long ' +
      'way off, which means steady rushing rather than detailed trickling.',
  },
  {
    id: 'step-grass',
    seconds: 0.7,
    influence: 0.55,
    prompt:
      'A heavy boot stamping down once onto dry straw and loose gravel, half a metre from the ' +
      'microphone. A loud short crunch. One stamp only. ' +
      'No music, no reverb, no echo, no second step, no voices.',
    note:
      'Played roughly four times a second while walking, so anything with a tail or a distinctive ' +
      'transient becomes unbearable within a minute. Short and dull is the requirement, but ' +
      'asking for a "soft" or "clearly audible" footstep produced clips 26 and 22 dB down. It ' +
      'took describing the physical action, a boot pressing into grass, to get a usable level. ' +
      'Same lesson as `ambience`: name the material and the action, not the volume.',
  },
  {
    id: 'step-wood',
    seconds: 0.7,
    influence: 0.55,
    prompt:
      'One single footstep on an old wooden plank deck, close to the microphone. ' +
      'A dull hollow knock with a faint creak of timber under the weight. Exactly one step. ' +
      'No music, no reverb, no echo, no second step, no voices.',
    note:
      'The pair to step-grass, and the pair is the point: the player should be able to hear that ' +
      'they have stepped onto the jetty without looking down. Hollow is what carries that.',
  },
  {
    id: 'chop',
    seconds: 1.3,
    influence: 0.5,
    prompt:
      'A single axe blow into a standing tree trunk, outdoors, close. A sharp heavy impact, ' +
      'the crack of wood fibres splitting, and a short woody ring afterwards. Exactly one blow. ' +
      'No music, no echo, no chopping rhythm, no falling tree, no voices.',
    note:
      'Chopping is one of the five ways past the palisade and the only one with no visual feedback ' +
      'beyond a percentage in a notice. The sound is doing the work of "that did something".',
  },
  {
    id: 'take',
    seconds: 0.6,
    influence: 0.5,
    prompt:
      'Picking a small object up off the ground, recorded close and loud. A short dry scuff of ' +
      'cloth and a clear wooden tap, plainly audible. One short sound. ' +
      'No music, no reverb, no voices.',
    note:
      'Deliberately smaller than `drop` in character. Not in level: the first version asked for ' +
      'a "light" tap and came back at 0.039, which no amount of gain fixes.',
  },
  {
    id: 'drop',
    seconds: 0.8,
    influence: 0.5,
    prompt:
      'Setting a small heavy object down onto dry earth, close to the microphone. A dull soft ' +
      'thud with a slight scatter of grit. One sound only. No music, no reverb, no voices.',
    note: 'The counterpart to `take`, and heavier on purpose so the pair is legible without looking.',
  },
  {
    id: 'merge',
    seconds: 2.4,
    influence: 0.65,
    prompt:
      'Two solid objects ground irreversibly into one, recorded close and loud. A brief dry ' +
      'grinding scrape of stone on metal, then immediately one deep muffled impact as they ' +
      'collapse together, then a low resonant tone decaying into silence. The impact comes at ' +
      'the very start, not the end. Sombre, heavy, final. ' +
      'No music, no chime, no bell, no sparkle, no rising pitch, no fanfare, no voices.',
    note:
      'The one cue in the set that carries a rule. Rule 3 is that both inputs are destroyed ' +
      'permanently and that the loss has to be real, so this must not be a reward sound. The ' +
      'exclusions in the prompt are the whole prompt: a sound effects model asked for "combining ' +
      'two items" will return a chime every time, and a chime tells the player they gained ' +
      'something. The shape asked for is grind, impact, decay, and it is the same shape the ' +
      'placeholder in `src/audio/cues.ts` renders and that `synth.test.ts` asserts. ' +
      'The first version gave the grind half a second and got one and a half, which put the ' +
      'impact 1.4 seconds after the button press. That is not only the wrong shape, it is late ' +
      'feedback, so the prompt now says when the impact arrives and the clip is shorter.',
  },
]

/**
 * Hard limit on the prompt, from the API.
 *
 * Found the way these things are always found: a 462 character merge prompt was
 * rejected with `text_too_long` AFTER three other clips had already been
 * generated and billed. `bake.ts` now checks every spec before it makes the
 * first request, because a validation that runs halfway through a paid batch is
 * not a validation.
 */
export const MAX_PROMPT = 450

/** Credits, from the ElevenLabs docs: 11 per second when a duration is given. */
export const CREDITS_PER_SECOND = 11

export function creditsFor(spec: SoundSpec): number {
  return Math.round(spec.seconds * CREDITS_PER_SECOND)
}
