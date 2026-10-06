import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Gate } from './features/auth/Gate.js'
import './index.css'
import { adoptIdentity } from './lib/identity.js'
import { createQueryClient } from './lib/queryClient.js'

const container = document.getElementById('root')
if (!container) {
  throw new Error('index.html is missing #root')
}

// Before the first render, so the identity is settled before anything stamps it
// on a write, and before the workspace reads the address bar, since this takes
// the handoff parameter back out of it.
adoptIdentity()

// Created once here rather than inside a component, so a re-render cannot drop the
// cache the socket is writing into.
const queryClient = createQueryClient()

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* The Gate, not the App: the blotter only mounts once there is a session,
          so nothing fetches or opens a socket before anyone has signed in. */}
      <Gate />
    </QueryClientProvider>
  </StrictMode>,
)
