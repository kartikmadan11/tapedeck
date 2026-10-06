/**
 * A seeded LCG, so seed data is byte-identical on every machine. Numerical Recipes
 * constants: statistical quality is irrelevant here, being deterministic,
 * dependency-free and identical across platforms is not.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    // A zero state works with these constants but reads as a mistake.
    this.state = seed >>> 0 || 1
  }

  /** The next float in [0, 1). */
  next(): number {
    this.state = (Math.imul(1_664_525, this.state) + 1_013_904_223) >>> 0
    return this.state / 0x1_0000_0000
  }

  /** An integer in [min, max], inclusive at both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** Throws on an empty list rather than returning undefined. */
  pick<T>(values: readonly T[]): T {
    const chosen = values[this.int(0, values.length - 1)]
    if (chosen === undefined) {
      throw new RangeError('cannot pick from an empty list')
    }
    return chosen
  }

  chance(probability: number): boolean {
    return this.next() < probability
  }
}
