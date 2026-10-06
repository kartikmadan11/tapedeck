import { BOOKS, INSTRUMENTS, type Rng, TRADERS, ticketSize, walkPrice } from '@tapedeck/database'
import type {
  AmendTradeInput,
  CancelTradeInput,
  CreateTradeInput,
  FillTradeInput,
  Trade,
} from '@tapedeck/shared'
import { COUNTERPARTIES, isWorking } from '@tapedeck/shared'

/** What the feed does on one tick. */
export type SimulationAction =
  | { kind: 'create'; input: CreateTradeInput }
  | { kind: 'amend'; tradeId: string; input: AmendTradeInput }
  | { kind: 'fill'; tradeId: string; input: FillTradeInput }
  | { kind: 'cancel'; tradeId: string; input: CancelTradeInput }

/**
 * Bookings and executions carry the feed, with a trickle of corrections. Fills
 * outweigh amendments and cancellations together because a desk executes far
 * more than it re-books. Cancel takes the remainder.
 */
const CREATE_WEIGHT = 0.46
const FILL_WEIGHT = 0.34
const AMEND_WEIGHT = 0.13

/** How often an execution closes the ticket rather than leaving a remainder. */
const COMPLETE_SHARE = 0.55

/**
 * Chooses the next write. Pure: no clock, no database, no timers.
 *
 * `open` is every trade a write can still touch. At `maxTrades` the booking
 * band is skipped and its share goes to the three writes against trades
 * already on the tape, so the table stops growing.
 */
export function nextAction(open: readonly Trade[], maxTrades: number, rng: Rng): SimulationAction {
  // Nothing on the tape, so the only legal move is to book.
  if (open.length === 0) {
    return { kind: 'create', input: createInput(rng) }
  }

  const roll =
    open.length >= maxTrades ? CREATE_WEIGHT + rng.next() * (1 - CREATE_WEIGHT) : rng.next()

  if (roll < CREATE_WEIGHT) {
    return { kind: 'create', input: createInput(rng) }
  }
  if (roll < CREATE_WEIGHT + FILL_WEIGHT) {
    const working = open.filter(isWorking)
    // A book with nothing left to execute amends instead of skipping the tick.
    return working.length > 0 ? fillAction(working, rng) : amendAction(open, rng)
  }
  if (roll < CREATE_WEIGHT + FILL_WEIGHT + AMEND_WEIGHT) {
    return amendAction(open, rng)
  }
  return cancelAction(open, rng)
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

/** Picked from the working trades only, since a filled one cannot fill again. */
function fillAction(working: readonly Trade[], rng: Rng): SimulationAction {
  const target = rng.pick(working)
  return {
    kind: 'fill',
    tradeId: target.tradeId,
    input: { filledQuantity: nextFill(target, rng), version: target.version },
  }
}

function cancelAction(open: readonly Trade[], rng: Rng): SimulationAction {
  const target = rng.pick(open)
  return { kind: 'cancel', tradeId: target.tradeId, input: { version: target.version } }
}

/**
 * The cumulative total after this execution: either the rest of the ticket or a
 * whole-lot step beyond what has already filled, so a trade can report twice
 * before it completes. Always advances, which is what the write path demands.
 */
function nextFill(target: Trade, rng: Rng): number {
  const remaining = target.quantity - target.filledQuantity
  const lotSize = lotSizeOf(target.symbol) ?? remaining
  const lots = Math.floor(remaining / lotSize)
  if (lots <= 1 || rng.chance(COMPLETE_SHARE)) {
    return target.quantity
  }
  return target.filledQuantity + lotSize * rng.int(1, lots - 1)
}

/**
 * Re-rolls the ticket against the instrument's lot size. An unknown instrument
 * keeps the existing quantity.
 */
function resize(target: Trade, rng: Rng): number {
  const lotSize = lotSizeOf(target.symbol)
  return lotSize === undefined ? target.quantity : ticketSize(lotSize, rng)
}

/** Undefined for a symbol outside the reference list, which a trade may carry. */
function lotSizeOf(symbol: string): number | undefined {
  return INSTRUMENTS.find((candidate) => candidate.symbol === symbol)?.lotSize
}
