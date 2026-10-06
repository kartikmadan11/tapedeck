import { describe, expect, it } from 'vitest'
import { formatCount, formatQuantity } from './format.js'

describe('formatQuantity', () => {
  it('groups thousands', () => {
    expect(formatQuantity(1_250_000)).toBe('1,250,000')
  })

  it('keeps a short sell negative rather than bracketed', () => {
    expect(formatQuantity(-400)).toBe('-400')
  })
})

describe('formatCount', () => {
  it('drops the s at one', () => {
    expect(formatCount(1, 'symbol')).toBe('1 symbol')
  })

  it('keeps it at none and at many', () => {
    expect(formatCount(0, 'symbol')).toBe('0 symbols')
    expect(formatCount(12, 'symbol')).toBe('12 symbols')
  })

  // The noun can be a phrase, which is why the -s goes on the end of it.
  it('pluralises the last word of a phrase', () => {
    expect(formatCount(2, 'active trade')).toBe('2 active trades')
  })

  it('groups the count as a quantity does', () => {
    expect(formatCount(1_500, 'trade')).toBe('1,500 trades')
  })
})
