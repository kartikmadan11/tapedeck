import { BOOKS, INSTRUMENTS, type Rng, TRADERS, ticketSize, walkPrice } from '@tapedeck/database'
import type { AmendTradeInput, CancelTradeInput, CreateTradeInput, Trade } from '@tapedeck/shared'
import { COUNTERPARTIES } from '@tapedeck/shared'

/**
 * What the feed does on one tick. A discriminated union rather than three
 * booleans, so the runner cannot execute two at once or none.
 */
export type SimulationAction =
  | { kind: 'create'; input: CreateTradeInput }
  | { kind: 'amend'; tradeId: string; input: AmendTradeInput }
  | { kind: 'cancel'; tradeId: string; input: CancelTradeInput }

/**
 * Mostly new trades with a trickle of corrections, which is what a desk's flow
 * looks like and means strike-throughs and version bumps appear on their own.
 */
const CREATE_WEIGHT = 0.7
const AMEND_WEIGHT = 0.2

/** Of the amend-or-cancel remainder, how much is an amend. Mirrors 0.2 : 0.1. */
const AMEND_SHARE = AMEND_WEIGHT / (AMEND_WEIGHT + (1 - CREATE_WEIGHT - AMEND_WEIGHT))

/**
 * Chooses the next write. Pure: no clock, no database, no timers, so every
 * branch is reachable from a test with a seeded Rng.
 *
 * `active` is the currently active trades, which is what an amend or a cancel
 * can legally target. At `maxTrades` the create branch is dropped and the
 * weights fall back to amend and cancel, so the table stops growing instead of
 * running past the size the specification asks for.
 */
export function nextAction(
  active: readonly Trade[],
  maxTrades: number,
  rng: Rng,
): SimulationAction {
  // Nothing to amend or cancel, so the only legal move is to book.
  if (active.length === 0) {
    return { kind: 'create', input: createInput(rng) }
  }

  if (active.length >= maxTrades) {
    return rng.chance(AMEND_SHARE) ? amendAction(active, rng) : cancelAction(active, rng)
  }

  const roll = rng.next()
  if (roll < CREATE_WEIGHT) {
    return { kind: 'create', input: createInput(rng) }
  }
  if (roll < CREATE_WEIGHT + AMEND_WEIGHT) {
    return amendAction(active, rng)
  }
  return cancelAction(active, rng)
}

/**
 * Built from the same reference data and the same ticket helpers as the seed, so
 * an incoming trade is indistinguishable in shape from a historical one.
 *
 * tradeTimestamp is left unset: the service stamps the moment of booking, which
 * is what makes the row land at the top of a newest-first blotter.
 */
function createInput(rng: Rng): CreateTradeInput {
  const instrument = rng.pick(INSTRUMENTS)
  return {
    symbol: instrument.symbol,
    side: rng.chance(0.52) ? 'BUY' : 'SELL',
    quantity: ticketSize(instrument.lotSize, rng),
    price: walkPrice(instrument.referencePrice, rng),
    // The actor is the simulator, but the trade still belongs to a desk trader.
    // Keeping the two apart is what lets the audit trail say a robot booked it.
    trader: rng.pick(TRADERS),
    book: rng.pick(BOOKS),
    counterparty: rng.pick(COUNTERPARTIES),
  }
}

/**
 * Drifts from the trade's own price rather than the instrument reference, so a
 * second amendment moves on from the first instead of snapping back.
 *
 * `version` is the targeted trade's current version, so a human amending the
 * same row first wins and this write is rejected as a conflict, which is the
 * behaviour under test rather than something to avoid.
 */
function amendAction(active: readonly Trade[], rng: Rng): SimulationAction {
  const target = rng.pick(active)
  return {
    kind: 'amend',
    tradeId: target.tradeId,
    input: {
      // Quantity and price only, because those are the two fields an amendment
      // can carry. Counterparty is not amendable, so the feed cannot demonstrate
      // changing one: it books a new trade against a different name instead.
      quantity: resize(target, rng),
      price: walkPrice(target.price, rng),
      version: target.version,
    },
  }
}

function cancelAction(active: readonly Trade[], rng: Rng): SimulationAction {
  const target = rng.pick(active)
  return { kind: 'cancel', tradeId: target.tradeId, input: { version: target.version } }
}

/**
 * Re-rolls the ticket against the instrument's lot size. A hand-booked trade can
 * carry a symbol that is not in the reference list, so an unknown instrument
 * keeps the existing quantity and lets the amendment move the price alone.
 */
function resize(target: Trade, rng: Rng): number {
  const instrument = INSTRUMENTS.find((candidate) => candidate.symbol === target.symbol)
  return instrument === undefined ? target.quantity : ticketSize(instrument.lotSize, rng)
}
