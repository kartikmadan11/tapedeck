import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './index.css'
import { createQueryClient } from './lib/queryClient.js'

const container = document.getElementById('root')
if (!container) {
  throw new Error('index.html is missing #root')
}

// Created once here rather than inside a component, so a re-render cannot drop the
// cache the socket is writing into.
const queryClient = createQueryClient()

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
