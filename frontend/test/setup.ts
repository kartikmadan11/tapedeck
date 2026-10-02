// Adds toBeInTheDocument and friends to Vitest's expect. The /vitest entry point
// registers against Vitest's matcher registry rather than Jest's.
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only unmounts automatically when Vitest globals are on, and they
// are off here so every test file imports what it uses. Without this, a second
// render finds the first one still in the document.
afterEach(cleanup)
