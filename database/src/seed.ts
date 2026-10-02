import { fileURLToPath } from 'node:url'
import {
  type DecimalString,
  fromMinorUnits,
  type Side,
  toDecimal,
  toMinorUnits,
} from '@tapedeck/shared'
import { sql } from 'drizzle-orm'
import { createDatabase, type DatabaseHandle } from './client.js'
import { toTrade } from './projection.js'
import { BOOKS, COUNTERPARTIES, INSTRUMENTS, SEED_ACTOR, TRADERS } from './reference.js'
import { Rng } from './rng.js'
import { tradeEvents, trades } from './schema.js'

// Deterministic, so the blotter matches the counts quoted in the README.
// Changing SEED invalidates those counts.
const SEED = 20_261_002
const TRADE_COUNT = 500

/** Fraction of trades later amended, and separately, later cancelled. */
const AMEND_RATE = 0.18
const CANCEL_RATE = 0.075

/** Trades are spread back over this many hours from the seed moment. */
const WINDOW_HOURS = 9

export interface SeedSummary {
  trades: number
  amended: number
  cancelled: number
  events: number
}

/**
 * Walks a reference price by up to 1.5 percent and snaps it to a tick, so the
 * blotter shows a spread rather than identical rows. Scaled integers only.
 */
function walkPrice(reference: string, rng: Rng): DecimalString {
  const base = toMinorUnits(toDecimal(reference))
  const driftBps = BigInt(rng.int(-150, 150))
  const drifted = base + (base * driftBps) / 10_000n
  // 1/100 of the quoted unit: plausible tick granularity.
  const tick = 10_000n
  const snapped = (drifted / tick) * tick
  return fromMinorUnits(snapped > 0n ? snapped : tick)
}

/** A multiple of the instrument's lot size. */
function ticketSize(lotSize: number, rng: Rng): number {
  const lots = rng.int(1, 8)
  return lotSize * lots
}

/**
 * Amendments and cancellations use the same shape of write as the API: read,
 * bump version, write, append an event. Nothing sets status or version directly,
 * which is what makes `version == count(events)` hold for every row, so the
 * history of a struck-through row agrees with the row.
 */
export async function seed(handle: DatabaseHandle): Promise<SeedSummary> {
  const { db } = handle
  const rng = new Rng(SEED)
  const now = new Date('2026-10-02T16:30:00.000Z')

  let amended = 0
  let cancelled = 0
  let events = 0

  await db.transaction(async (tx) => {
    for (let i = 0; i < TRADE_COUNT; i += 1) {
      const instrument = rng.pick(INSTRUMENTS)
      const side: Side = rng.chance(0.52) ? 'BUY' : 'SELL'
      const minutesAgo = rng.int(0, WINDOW_HOURS * 60)
      const tradeTimestamp = new Date(now.getTime() - minutesAgo * 60_000)

      const [created] = await tx
        .insert(trades)
        .values({
          symbol: instrument.symbol,
          side,
          quantity: ticketSize(instrument.lotSize, rng),
          price: walkPrice(instrument.referencePrice, rng),
          trader: rng.pick(TRADERS),
          book: rng.pick(BOOKS),
          counterparty: rng.pick(COUNTERPARTIES),
          tradeTimestamp,
        })
        .returning()

      if (!created) {
        throw new Error('insert returned no row')
      }

      let current = created
      await tx.insert(tradeEvents).values({
        tradeId: current.tradeId,
        eventType: 'CREATED',
        before: null,
        after: toTrade(current),
        actor: SEED_ACTOR,
        at: tradeTimestamp,
      })
      events += 1

      // Re-priced or re-sized after booking. Only the amendable fields move.
      if (rng.chance(AMEND_RATE)) {
        const before = toTrade(current)
        const amendedAt = new Date(tradeTimestamp.getTime() + rng.int(1, 20) * 60_000)

        const [next] = await tx
          .update(trades)
          .set({
            quantity: ticketSize(instrument.lotSize, rng),
            price: walkPrice(instrument.referencePrice, rng),
            counterparty: rng.pick(COUNTERPARTIES),
            version: current.version + 1,
            updatedAt: amendedAt,
          })
          .where(sql`${trades.tradeId} = ${current.tradeId}`)
          .returning()

        if (!next) {
          throw new Error('amend returned no row')
        }
        current = next

        await tx.insert(tradeEvents).values({
          tradeId: current.tradeId,
          eventType: 'AMENDED',
          before,
          after: toTrade(current),
          actor: rng.pick(TRADERS),
          at: amendedAt,
        })
        events += 1
        amended += 1
      }

      // Struck from the blotter but never deleted. Applied after any amendment,
      // so a cancelled trade can carry a three-event history.
      if (rng.chance(CANCEL_RATE)) {
        const before = toTrade(current)
        const cancelledAt = new Date(current.updatedAt.getTime() + rng.int(1, 30) * 60_000)

        const [next] = await tx
          .update(trades)
          .set({
            status: 'CANCELLED',
            version: current.version + 1,
            updatedAt: cancelledAt,
          })
          .where(sql`${trades.tradeId} = ${current.tradeId}`)
          .returning()

        if (!next) {
          throw new Error('cancel returned no row')
        }
        current = next

        await tx.insert(tradeEvents).values({
          tradeId: current.tradeId,
          eventType: 'CANCELLED',
          before,
          after: toTrade(current),
          actor: rng.pick(TRADERS),
          at: cancelledAt,
        })
        events += 1
        cancelled += 1
      }
    }
  })

  return { trades: TRADE_COUNT, amended, cancelled, events }
}

/**
 * Seeds only when the table is empty: `docker compose up` gets run more than
 * once, and a blotter showing 1000 trades reads as an application bug.
 */
export async function seedIfEmpty(handle: DatabaseHandle): Promise<SeedSummary | null> {
  const [row] = await handle.db.select({ count: sql<number>`count(*)::int` }).from(trades).limit(1)

  if (row && row.count > 0) {
    return null
  }
  return seed(handle)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }
  const handle = createDatabase(url)
  try {
    const summary = await seedIfEmpty(handle)
    if (summary === null) {
      console.error('trades already present, skipping seed')
    } else {
      console.error(
        `seeded ${summary.trades} trades: ${summary.amended} amended, ` +
          `${summary.cancelled} cancelled, ${summary.events} events`,
      )
    }
  } finally {
    await handle.close()
  }
}
