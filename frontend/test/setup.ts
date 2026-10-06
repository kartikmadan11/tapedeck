// The /vitest entry point registers against Vitest's matcher registry, not Jest's.
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only unmounts automatically when Vitest globals are on, and they
// are off here. Without this, a second render finds the first still in the document.
afterEach(cleanup)

// jsdom declares scrollIntoView and does not implement it.
Element.prototype.scrollIntoView = (): void => {}

// jsdom dispatches pointer events but has no capture, and the separators ask for
// it. Unstubbed it throws on pointerdown.
Element.prototype.setPointerCapture = (): void => {}
Element.prototype.releasePointerCapture = (): void => {}

/**
 * jsdom has no media queries at all, and the landing page's tape asks whether
 * motion is wanted before it starts printing. Answers no preference, which is the
 * path a browser takes by default.
 */
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
  }),
})

/**
 * jsdom declares no DragEvent, so Testing Library falls back to a plain Event and
 * drops the properties a drag handler reads off one. MouseEvent carries
 * relatedTarget, which the drop zones use to tell a pointer crossing between two
 * zones of one pane from one leaving the pane. dataTransfer is on neither, so a
 * test that needs one passes a stub.
 */
Object.defineProperty(globalThis, 'DragEvent', { configurable: true, value: MouseEvent })

/**
 * The virtualiser sizes its window from the scroll element's offsetHeight, which
 * jsdom hardcodes to 0, so left alone it renders no rows at all. virtual-core's
 * getRect reads offsetWidth and offsetHeight, not getBoundingClientRect, and with
 * no ResizeObserver in jsdom this read on mount is its only measurement.
 *
 * 640px is a viewport's worth of 32px rows, so a test sees about twenty of them
 * plus the overscan rather than all five hundred.
 */
for (const [property, size] of [
  ['offsetHeight', 640],
  ['offsetWidth', 1308],
] as const) {
  Object.defineProperty(HTMLElement.prototype, property, {
    configurable: true,
    get(): number {
      return size
    },
  })
}
