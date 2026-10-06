// The /vitest entry point registers against Vitest's matcher registry, not Jest's.
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only unmounts itself when Vitest globals are on, and they are off
// here. Without this a second render finds the first still in the document.
afterEach(cleanup)

// jsdom declares scrollIntoView and does not implement it.
Element.prototype.scrollIntoView = (): void => {}

// jsdom dispatches pointer events but has no capture, which the separators ask for.
// Unstubbed it throws on pointerdown.
Element.prototype.setPointerCapture = (): void => {}
Element.prototype.releasePointerCapture = (): void => {}

// jsdom has no media queries, and the landing tape asks about motion before it
// starts printing. Answers no preference, the browser default path.
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
  }),
})

// jsdom declares no DragEvent, so Testing Library falls back to a plain Event and
// drops what a drag handler reads. MouseEvent carries relatedTarget, which the drop
// zones need. dataTransfer is on neither, so a test that needs one passes a stub.
Object.defineProperty(globalThis, 'DragEvent', { configurable: true, value: MouseEvent })

// The virtualiser sizes its window from offsetHeight, which jsdom hardcodes to 0, so
// left alone it renders no rows. virtual-core reads offsetWidth and offsetHeight, not
// getBoundingClientRect, and with no ResizeObserver this mount read is its only one.
// 640px is twenty 32px rows, so a test sees those and overscan, not all five hundred.
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
