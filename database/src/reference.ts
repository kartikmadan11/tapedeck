export const TRADERS: readonly string[] = [
  'a.patel',
  'j.okonkwo',
  'm.lindqvist',
  's.fernandes',
  'r.chatterjee',
  'd.okafor',
  'l.moreau',
  'k.yamamoto',
]

/** Re-exported, not declared: a second copy drifts out of the one that rejects.
 *  The seed walks each instrument's reference price to produce a spread. */
export type { Instrument } from '@tapedeck/shared'
export { BOOKS, INSTRUMENTS } from '@tapedeck/shared'

/** Recorded on seeded events, so seeded history is distinguishable. */
export const SEED_ACTOR = 'seed'
