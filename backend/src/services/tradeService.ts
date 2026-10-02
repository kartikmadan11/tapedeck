import type {
  AmendTradeInput,
  CancelTradeInput,
  CreateTradeInput,
  Position,
  ServerFrame,
  Trade,
  TradeEvent,
  TradeEventType,
  TradeQuery,
} from '@tapedeck/shared'
import type { Bus } from '../bus.js'
import type { ConsistentSnapshot, MutationResult, TradeRepository } from '../repositories/trades.js'

const FRAME_TYPE: Record<TradeEventType, 'trade.created' | 'trade.amended' | 'trade.cancelled'> = {
  CREATED: 'trade.created',
  AMENDED: 'trade.amended',
  CANCELLED: 'trade.cancelled',
}

/**
 * The write path: mutate, then publish, strictly after commit. Publishing from
 * inside the transaction would make a frame visible before the row was durable,
 * so a rollback would leave clients showing a trade that does not exist.
 *
 * The repository serialises writes, so frames reach the bus in commit order.
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

  async createTrade(input: CreateTradeInput, actor: string): Promise<Trade> {
    return this.publish(await this.repository.createTrade(input, actor))
  }

  async amendTrade(tradeId: string, input: AmendTradeInput, actor: string): Promise<Trade> {
    return this.publish(await this.repository.amendTrade(tradeId, input, actor))
  }

  async cancelTrade(tradeId: string, input: CancelTradeInput, actor: string): Promise<Trade> {
    return this.publish(await this.repository.cancelTrade(tradeId, input.version, actor))
  }

  /**
   * Two frames per mutation, and only the delta carries a cursor. Positions are
   * re-read rather than adjusted in memory, so the panel is always whatever
   * Postgres says it is.
   */
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
