import type { UseMutationResult } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import type { Credentials, Session } from '@tapedeck/shared'
import type { ApiRequestError } from '../../lib/api.js'
import { login, register } from '../../lib/api.js'
import { writeSession } from '../../lib/session.js'
import type { Intent } from './intent.js'

/**
 * Registering and logging in differ only in which endpoint they post to, so one
 * hook covers both and the session is stored in one place either way. Nothing
 * here is cached: a sign-in is not a query, and the token must not outlive the
 * window in a query cache.
 */
export function useAuth(
  intent: Intent,
  onSignedIn: (session: Session) => void,
): UseMutationResult<Session, ApiRequestError, Credentials> {
  return useMutation({
    mutationFn: intent === 'login' ? login : register,
    onSuccess: (session) => {
      // Stored before the caller is told, so the first request the app makes
      // already carries the token.
      writeSession(session)
      onSignedIn(session)
    },
  })
}
