import type { UseMutationResult } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import type { Credentials, Session } from '@tapedeck/shared'
import type { ApiRequestError } from '../../lib/api.js'
import { login, register } from '../../lib/api.js'
import { writeSession } from '../../lib/session.js'
import type { Intent } from './intent.js'

/** Register and login differ only in the endpoint, so one hook stores the session
 *  in one place. Nothing is cached: the token must not outlive the window. */
export function useAuth(
  intent: Intent,
  onSignedIn: (session: Session) => void,
): UseMutationResult<Session, ApiRequestError, Credentials> {
  return useMutation({
    mutationFn: intent === 'login' ? login : register,
    onSuccess: (session) => {
      // Stored before the caller is told, so the app's first request carries it.
      writeSession(session)
      onSignedIn(session)
    },
  })
}
