/**
 * UTC, stated rather than left to the viewer's timezone, because the wire is UTC
 * and two traders in two offices have to read the same instant.
 */
const UTC_DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const UTC_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const INTEGER = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

export function formatDateTime(iso: string): string {
  return UTC_DATE_TIME.format(new Date(iso))
}

export function formatTime(iso: string): string {
  return UTC_TIME.format(new Date(iso))
}

/** Quantities are whole shares, so grouping is the only formatting needed. */
export function formatQuantity(quantity: number): string {
  return INTEGER.format(quantity)
}
