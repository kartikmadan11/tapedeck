/**
 * Everything on the wire is UTC and everything on screen says so. A blotter that
 * silently renders in the viewer's timezone makes two traders in two offices
 * disagree about when a trade happened.
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
