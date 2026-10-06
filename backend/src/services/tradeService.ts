import type {
  AmendTradeInput,
  CancelTradeInput,
  CreateTradeInput,
  FillTradeInput,
  Position,
  ServerFrame,
  Trade,
  TradeDeltaFrame,
  TradeEvent,
  TradeEventType,
  TradeQuery,
} from '@tapedeck/shared'
import type { Bus } from '../bus.js'
import type { ConsistentSnapshot, MutationResult, TradeRepository } from '../repositories/trades.js'

const FRAME_TYPE: Record<TradeEventType, TradeDeltaFrame['type']> = {
  CREATED: 'trade.created',
  AMENDED: 'trade.amended',
  FILLED: 'trade.filled',
  CANCELLED: 'trade.cancelled',
}

/**
 * Mutate, then publish, strictly after commit: publishing inside the transaction
 * makes a frame visible before the row is durable, so a rollback leaves clients
 * showing a trade that never existed. Writes serialise, so frames reach the bus in
 * commit order.
 */
export class TradeService {
  private readonly repository: TradeRepository
  private readonly bus: Bus

  constructor(repository: TradeRepository, bus: Bus) {
    this.repository = repository
    this.bus = bus
  }

  readSnapshot(query?: TradeQuery): Promise<ConsistentSnapshot> {
    return this.repository.readSnapshot(query)
  }

  listTrades(query?: TradeQuery): Promise<{ seq: number; trades: Trade[] }> {
    return this.repository.listTrades(query)
  }

  listPositions(): Promise<{ seq: number; positions: Position[] }> {
    return this.repository.listPositions()
  }

  findTrade(tradeId: string): Promise<Trade | null> {
    return this.repository.findTrade(tradeId)
  }

  listEvents(tradeId: string): Promise<TradeEvent[]> {
    return this.repository.listEvents(tradeId)
  }

  /** Reports whether anything was booked, so the route can answer 201 or 200. A replay
   * publishes nothing: no event was written, so there is no seq to put on a frame. */
  async createTrade(
    input: CreateTradeInput,
    actor: string,
  ): Promise<{ trade: Trade; replayed: boolean }> {
    const outcome = await this.repository.createTrade(input, actor)
    if (outcome.replayed) {
      return { trade: outcome.trade, replayed: true }
    }
    return { trade: await this.publish(outcome.result), replayed: false }
  }

  async amendTrade(tradeId: string, input: AmendTradeInput, actor: string): Promise<Trade> {
    return this.publish(await this.repository.amendTrade(tradeId, input, actor))
  }

  async fillTrade(tradeId: string, input: FillTradeInput, actor: string): Promise<Trade> {
    return this.publish(await this.repository.fillTrade(tradeId, input, actor))
  }

  async cancelTrade(tradeId: string, input: CancelTradeInput, actor: string): Promise<Trade> {
    return this.publish(await this.repository.cancelTrade(tradeId, input.version, actor))
  }

  /** Two frames per mutation, only the delta carrying a cursor. Positions are re-read,
   * not adjusted in memory. */
  private async publish(result: MutationResult): Promise<Trade> {
    const delta: ServerFrame = {
      type: FRAME_TYPE[result.eventType],
      seq: result.seq,
      trade: result.trade,
    }
    this.bus.publish(delta)

    const { positions } = await this.repository.listPositions()
    this.bus.publish({ type: 'positions', positions })

    return result.trade
  }
}
