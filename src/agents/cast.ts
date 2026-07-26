/**
 * The people, authored.
 *
 * Four of them: the gate guard from A5, and the three who live at home from A1.
 * All Band 0, so all of them are plain and warm, per the band discipline in
 * `docs/DESIGN.md`. Band 3 people say LESS, not more, and the test at the
 * bottom of `npc.test.ts` holds the line on that in advance.
 *
 * The guard is the one carrying the design weight. Six ways through him:
 *
 *   bribe        anything VALUABLE at or above his greed, and the cheapest
 *                sufficient thing is what he takes
 *   frighten     anything FRIGHTENING at or above his fear
 *   lie          tell him something is burning, which works only when
 *                something IS burning
 *   bore         wait him out, because his boredom starts at 0.8 and rises
 *   blackmail    what Wren told you about his shift, which is the only route
 *                that runs through a second person
 *   walk away    burn, cut or climb the palisade somewhere he is not
 *
 * Only the last of those is unauthored, and it is the one that matters most.
 * Everything above it is a convenience; a guard you can ONLY talk past is a
 * lock with a conversational key.
 *
 * Note what the guard does not have: a hit point count, a faction, and any
 * option that exists to be the correct one.
 */

import { CATALOG, RECIPES } from '../items'
import type { NpcDef, NpcState, Said, Situation } from './npc'
import { choose } from './npc'

/**
 * Wren's suggestion, computed from what you are carrying.
 *
 * She names the two things and never the result, because the moment she says
 * what they make she is a recipe list with a face. Deterministic: the first
 * pair in recipe order wins, so the same pack gets the same question forever.
 */
export function suggestFromPack(sit: Situation): string {
  const have = new Set(sit.carried)
  const hit = RECIPES.find((r) => have.has(r.inputs[0]) && have.has(r.inputs[1]))
  if (!hit) return 'Nothing in there wants to be anything else. Not yet, anyway.'

  const a = CATALOG[hit.inputs[0]]!.name
  const b = CATALOG[hit.inputs[1]]!.name
  return `The ${a} and the ${b}. Has anybody ever put those two together?`
}

export const GATE_GUARD: NpcDef = {
  id: 'gate_guard',
  name: 'The Gate Guard',
  blurb: 'Young, cold, and counting the hours until somebody relieves him.',
  band: 0,
  // The way out, whichever way out a region ends up having.
  stands: 'exit',
  disposition: 0.5,
  /**
   * Greed was 0.6, and at 0.6 he could not be bribed at all: the most VALUABLE
   * thing Band 0 can produce is the sword at 0.5, and the merge results carry
   * their parents' value rather than summing it. The bribe was dead content and
   * had been since it was written, which nobody noticed because the other five
   * routes work. `npc.test.ts` computes this now instead of trusting it.
   *
   * 0.5 is therefore a price with a meaning: the sword, or something made from
   * it, and nothing else. Handing over the best thing you own to walk through a
   * gate is the trade this is supposed to be. Do not raise this without raising
   * something in the catalog to match, and the test will say so if you do.
   */
  drives: { greed: 0.5, fear: 0.35, loyalty: 0.4, curiosity: 0.2, boredom: 0.8 },
  routesPast: [
    { prop: 'HOT', min: 0.35, says: 'Burn the palisade somewhere down the line and walk through the gap.' },
    { prop: 'TOOL_CUTTING', min: 0.45, says: 'Cut through the wall where he is not standing.' },
    { prop: 'LADDER_LIKE', min: 0.45, says: 'Go over it further along, out of his sight.' },
  ],
  nodes: [
    // Ordered first, so a guard you have lied to twice opens here instead.
    {
      id: 'sour',
      says: 'You have had your answer.',
      when: [{ kind: 'disposition', max: 0.2 }],
      options: [
        {
          id: 'threaten_sour',
          text: 'Step aside.',
          requires: [{ kind: 'property', prop: 'FRIGHTENING', min: { drive: 'fear' } }],
          then: {
            reply: 'All right. All right. I never saw you.',
            disposition: -0.1,
            drives: { fear: 0.2 },
            resolve: { kind: 'pacify' },
          },
        },
        {
          id: 'wait_sour',
          text: '(say nothing, and wait)',
          then: {
            reply: 'He turns his back and watches the road instead.',
            drives: { boredom: 0.07 },
            goto: 'sour',
          },
        },
        { id: 'leave_sour', text: '(walk away)', then: { reply: 'Good.', goto: 'end' } },
      ],
    },
    {
      id: 'start',
      says: 'Nobody through after dark. Sergeant’s orders.',
      options: [
        {
          id: 'whose_orders',
          text: 'Whose orders?',
          then: {
            reply: 'Sergeant Aille. You will not have met him. Count that as luck.',
            remember: 'asked_orders',
            drives: { boredom: 0.05 },
            goto: 'start',
          },
        },
        {
          // The property gate, and the reason it is a property gate: any
          // sufficiently valuable thing works, including one merged into being
          // a minute ago. His greed IS the price, so a Haggling skill that
          // lowers greed lowers the cost of every bribe in the game at once.
          id: 'bribe',
          text: 'It is worth a coin to me.',
          requires: [{ kind: 'property', prop: 'VALUABLE', min: { drive: 'greed' } }],
          then: {
            reply: 'That will do. Go on, and be quick about it.',
            consumes: true,
            disposition: 0.05,
            drives: { greed: -0.1 },
            resolve: { kind: 'pacify' },
          },
        },
        {
          // The one from A5 that is worth more than any amount of branching.
          // Offered whether or not anything is burning, because a lie you are
          // warned about is not a lie.
          id: 'fire_behind_you',
          text: 'There is a fire behind you.',
          claim: 'something_burning',
          then: {
            reply: 'God. Stay there.',
            drives: { fear: 0.3, boredom: -0.5 },
            resolve: { kind: 'pacify' },
          },
          caught: {
            reply: 'There is not. Do not do that again.',
            disposition: -0.25,
            drives: { boredom: -0.1 },
            remember: 'lied_about_fire',
            goto: 'start',
          },
        },
        {
          id: 'threaten',
          text: 'Step aside.',
          requires: [{ kind: 'property', prop: 'FRIGHTENING', min: { drive: 'fear' } }],
          then: {
            reply: 'All right. All right. I never saw you.',
            disposition: -0.3,
            drives: { fear: 0.2 },
            resolve: { kind: 'pacify' },
          },
        },
        {
          /**
           * What Wren told you, used. Nothing about this is a quest step: the
           * flag is knowledge, the option is offered the moment you have it,
           * and if you never talk to her it simply is not there. Note that it
           * costs disposition. He does what you want and likes you less.
           */
          id: 'the_swap',
          text: 'You swapped shifts and told nobody.',
          requires: [{ kind: 'done', flag: 'knows_the_swap' }],
          then: {
            reply: 'Who said that. Go on, then. Quick, and we never spoke.',
            disposition: -0.1,
            drives: { fear: 0.2 },
            resolve: { kind: 'pacify' },
          },
        },
        {
          id: 'wait',
          text: '(say nothing, and wait)',
          requires: [{ kind: 'drive', drive: 'boredom', max: 0.94 }],
          then: {
            reply: 'He shifts his weight and looks off down the road.',
            drives: { boredom: 0.07 },
            goto: 'start',
          },
        },
        {
          id: 'wait_more',
          text: '(keep waiting)',
          requires: [{ kind: 'drive', drive: 'boredom', min: 0.95 }],
          then: {
            reply: 'Go on then. I never saw you and you never saw me.',
            drives: { boredom: -0.4 },
            resolve: { kind: 'pacify' },
          },
        },
        { id: 'leave', text: '(walk away)', then: { reply: 'Aye.', goto: 'end' } },
      ],
    },
  ],
}

/**
 * The Keeper. Explains nothing unless asked, and answers only what is asked.
 *
 * He is where a player learns that dialogue has options at all, and the bench
 * question is the tutorial for D18: two things go on, and if they do not make a
 * third you get both of them back. Nobody says the word recipe.
 */
export const KEEPER: NpcDef = {
  id: 'keeper',
  name: 'The Keeper',
  blurb: 'Elderly, runs the hearth, and has outlived most of the people who left.',
  band: 0,
  stands: 'home',
  disposition: 0.7,
  drives: { greed: 0.1, fear: 0.15, loyalty: 0.9, curiosity: 0.25, boredom: 0.3 },
  routesPast: [],
  nodes: [
    {
      id: 'start',
      says: 'You are up early.',
      options: [
        {
          id: 'out_there',
          text: 'What is out there?',
          then: {
            reply: 'Fields. Then woods. Then I could not tell you.',
            remember: 'asked_out_there',
            goto: 'start',
          },
        },
        {
          id: 'last_one',
          text: 'What happened to the last one?',
          then: {
            reply: 'He went out with a good axe. He came back as a name on the board.',
            remember: 'asked_last_one',
            goto: 'start',
          },
        },
        {
          id: 'the_bench',
          text: 'How does the bench work?',
          then: {
            reply: 'You put two things on it. If they make a third, it takes both. If they do not, it hands them back.',
            remember: 'asked_bench',
            goto: 'start',
          },
        },
        {
          id: 'the_fire',
          text: 'How do I get a fire going out there?',
          then: {
            reply: 'Iron and a hard stone. Everything after that is just dry grass and patience.',
            remember: 'asked_fire',
            goto: 'start',
          },
        },
        { id: 'nothing', text: 'Nothing.', then: { reply: 'Right you are.', goto: 'end' } },
      ],
    },
  ],
}

/**
 * Wren. Teaches merging by being curious rather than by instructing.
 *
 * Her one useful option computes its reply from the pack, so she is a different
 * conversation every time without a word of it being branching dialogue.
 */
export const WREN: NpcDef = {
  id: 'wren',
  name: 'Wren',
  blurb: 'The smith’s daughter. Bored, and interested in absolutely everything.',
  band: 0,
  // Somewhere people work, and the chopping block if the region has one, so a
  // player meets her on the way out rather than having to go looking.
  stands: 'work',
  prefer: 'block',
  disposition: 0.6,
  drives: { greed: 0.3, fear: 0.1, loyalty: 0.5, curiosity: 0.9, boredom: 0.7 },
  routesPast: [],
  nodes: [
    {
      id: 'start',
      says: 'You have been picking things up again. Go on, show me.',
      options: [
        {
          id: 'show',
          text: 'Here.',
          then: { reply: '', suggest: true, drives: { curiosity: 0.05, boredom: -0.1 }, goto: 'start' },
        },
        {
          id: 'about_the_sword',
          text: 'What would you do with a sword?',
          requires: [{ kind: 'item', item: 'sword' }],
          then: {
            reply: 'Not carry it down the lane, for a start. People remember a thing like that.',
            remember: 'asked_sword',
            goto: 'start',
          },
        },
        {
          id: 'about_the_key',
          text: 'What does this key open?',
          requires: [{ kind: 'item', item: 'key' }],
          then: {
            reply: 'Not our door. Try the mill, they lost theirs years back and never said how.',
            remember: 'asked_key',
            goto: 'start',
          },
        },
        {
          /**
           * The only run flag in the game, and the reason the `done` gate is
           * not scaffolding: this is one person's gossip becoming another
           * person's problem. She is not sending you anywhere and does not know
           * you want through the gate, which is what keeps her the opposite of
           * a quest giver. She just knows everything about everyone.
           */
          id: 'about_the_gate',
          text: 'Who is on the gate tonight?',
          requires: [{ kind: 'said', line: 'asked_gate', is: false }],
          then: {
            reply: 'The young one. He swapped with my cousin and never told the sergeant. He thinks nobody noticed.',
            remember: 'asked_gate',
            sets: 'knows_the_swap',
            goto: 'start',
          },
        },
        { id: 'later', text: 'Not now.', then: { reply: 'Suit yourself.', goto: 'end' } },
      ],
    },
  ],
}

/**
 * The Ferryman. The anti-quest-marker, per D20.
 *
 * Asked where to go, he will not say. Asked what he has seen, he describes what
 * people carried back and never once where they had been. Each answer gates on
 * the last, so the order is fixed without any randomness.
 */
export const FERRYMAN: NpcDef = {
  id: 'ferryman',
  name: 'The Ferryman',
  blurb: 'Sits by the gate. Has watched a great many people leave.',
  band: 0,
  // Same place as the guard, and that is the point: the guard blocks it, so he
  // gets the spot, and the ferryman is put beside him.
  stands: 'exit',
  disposition: 0.5,
  drives: { greed: 0.2, fear: 0.2, loyalty: 0.3, curiosity: 0.4, boredom: 0.6 },
  routesPast: [],
  nodes: [
    {
      id: 'start',
      says: 'Sit if you like. I am not going anywhere.',
      options: [
        {
          id: 'where',
          text: 'Where should I go?',
          then: {
            reply: 'That is not a thing I tell people.',
            remember: 'asked_where',
            goto: 'start',
          },
        },
        {
          id: 'seen_one',
          text: 'What have you seen come back?',
          requires: [{ kind: 'said', line: 'seen_one', is: false }],
          then: {
            reply: 'A woman with a bucket that would not hold water. She would not put it down either.',
            remember: 'seen_one',
            goto: 'start',
          },
        },
        {
          id: 'seen_two',
          text: 'What else?',
          requires: [{ kind: 'said', line: 'seen_one' }, { kind: 'said', line: 'seen_two', is: false }],
          then: {
            reply: 'A man with a good coil of rope and no boots. He never did say what the trade had been.',
            remember: 'seen_two',
            goto: 'start',
          },
        },
        {
          id: 'seen_three',
          text: 'And?',
          requires: [{ kind: 'said', line: 'seen_two' }, { kind: 'said', line: 'seen_three', is: false }],
          then: {
            reply: 'A boy carrying a door. Just a door. He got it home, as well.',
            remember: 'seen_three',
            goto: 'start',
          },
        },
        { id: 'go', text: 'I should go.', then: { reply: 'You should.', goto: 'end' } },
      ],
    },
  ],
}

export const CAST: NpcDef[] = [GATE_GUARD, KEEPER, WREN, FERRYMAN]

const BY_ID = new Map(CAST.map((n) => [n.id, n]))

export function npc(id: string): NpcDef | undefined {
  return BY_ID.get(id)
}

/**
 * `choose` with Wren's computed reply already wired in.
 *
 * This is the one `main.ts` should call. The plain `choose` in `npc.ts` takes
 * the suggestion function as an argument purely so that module stays free of
 * the recipe book.
 */
export function say(def: NpcDef, state: NpcState, sit: Situation, optionId: string): Said {
  return choose(def, state, sit, optionId, suggestFromPack)
}
