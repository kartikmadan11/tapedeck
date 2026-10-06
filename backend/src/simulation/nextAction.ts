import { BOOKS, INSTRUMENTS, type Rng, TRADERS, ticketSize, walkPrice } from '@tapedeck/database'
import type { AmendTradeInput, CancelTradeInput, CreateTradeInput, Trade } from '@tapedeck/shared'
import { COUNTERPARTIES } from '@tapedeck/shared'

/** What the feed does on one tick. */
export type SimulationAction =
  | { kind: 'create'; input: CreateTradeInput }
  | { kind: 'amend'; tradeId: string; input: AmendTradeInput }
  | { kind: 'cancel'; tradeId: string; input: CancelTradeInput }

/** Mostly new trades with a trickle of corrections. */
const CREATE_WEIGHT = 0.7
const AMEND_WEIGHT = 0.2

/** Of the amend-or-cancel remainder, how much is an amend. Mirrors 0.2 : 0.1. */
const AMEND_SHARE = AMEND_WEIGHT / (AMEND_WEIGHT + (1 - CREATE_WEIGHT - AMEND_WEIGHT))

/**
 * Chooses the next write. Pure: no clock, no database, no timers. At
 * `maxTrades` the create branch is dropped and the weights fall back to amend
 * and cancel, so the table stops growing.
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
 * Built from the same reference data and ticket helpers as the seed.
 * tradeTimestamp is left unset: the service stamps the moment of booking.
 */
function createInput(rng: Rng): CreateTradeInput {
  const instrument = rng.pick(INSTRUMENTS)
  return {
    symbol: instrument.symbol,
    side: rng.chance(0.52) ? 'BUY' : 'SELL',
    quantity: ticketSize(instrument.lotSize, rng),
    price: walkPrice(instrument.referencePrice, rng),
    // The actor is the simulator, but the trade still belongs to a desk trader.
    trader: rng.pick(TRADERS),
    book: rng.pick(BOOKS),
    counterparty: rng.pick(COUNTERPARTIES),
  }
}

/**
 * Drifts from the trade's own price rather than the instrument reference, so a
 * second amendment moves on from the first instead of snapping back. `version`
 * is the target's current version, so a human amending the same row first wins
 * and this write is rejected as a conflict.
 */
function amendAction(active: readonly Trade[], rng: Rng): SimulationAction {
  const target = rng.pick(active)
  return {
    kind: 'amend',
    tradeId: target.tradeId,
    input: {
      // Quantity and price only: the two fields an amendment can carry.
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
 * carry a symbol outside the reference list, so an unknown instrument keeps the
 * existing quantity.
 */
function resize(target: Trade, rng: Rng): number {
  const instrument = INSTRUMENTS.find((candidate) => candidate.symbol === target.symbol)
  return instrument === undefined ? target.quantity : ticketSize(instrument.lotSize, rng)
}
