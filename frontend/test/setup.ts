// Adds toBeInTheDocument and friends to Vitest's expect. The /vitest entry point
// registers against Vitest's matcher registry rather than Jest's.
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only unmounts automatically when Vitest globals are on, and they
// are off here so every test file imports what it uses. Without this, a second
// render finds the first one still in the document.
afterEach(cleanup)

// jsdom has no layout, so it declares scrollIntoView and then does not implement
// it. Stubbed here rather than guarded at the call site, since the blotter
// keeping the arrow-keyed row in view is real behaviour and should not have to
// carry a check for the test environment.
Element.prototype.scrollIntoView = (): void => {}

// The same gap in the pointer API. jsdom dispatches pointer events but has no
// capture, and the separators ask for it so a fast drag cannot outrun the 8px
// handle. Unstubbed it throws on pointerdown, which would fail a drag test for a
// reason that has nothing to do with the drag.
Element.prototype.setPointerCapture = (): void => {}
Element.prototype.releasePointerCapture = (): void => {}

/**
 * jsdom declares no DragEvent at all, so Testing Library falls back to a plain
 * Event and quietly drops the properties a drag handler reads off one.
 *
 * relatedTarget is the one that matters: the drop zones use it to tell a pointer
 * crossing between two zones of the same pane from a pointer leaving the pane
 * altogether, and without it every crossing reads as a departure and the test
 * fails for a reason that is not in the component.
 *
 * MouseEvent rather than a class written out here, because it already carries
 * relatedTarget and the coordinates, which is everything these handlers touch.
 * dataTransfer is on neither, so a test that needs one still passes a stub.
 */
Object.defineProperty(globalThis, 'DragEvent', { configurable: true, value: MouseEvent })

/**
 * The same gap, one layer deeper. The blotter virtualises its rows, and the
 * virtualiser sizes its window from the scroll element's offsetHeight, which
 * jsdom hardcodes to 0. Left alone it would conclude that no rows fit and render
 * none of them, so every row assertion in the suite would fail at once and none
 * of them would say why.
 *
 * offsetHeight and not getBoundingClientRect: virtual-core's getRect reads
 * offsetWidth and offsetHeight, and shimming the wrong one of the two looks
 * identical from here. jsdom has no ResizeObserver either, so this single read on
 * mount is the only measurement the virtualiser ever gets.
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
