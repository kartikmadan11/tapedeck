import type { ReactElement } from 'react'
import { ApiRequestError } from '../lib/api.js'

type Props = { error: unknown; className?: string }

/**
 * Renders the server's typed error rather than its status code: the ways an
 * amend can fail are different things to tell someone.
 */
export function ErrorNotice({ error, className = '' }: Props): ReactElement {
  return (
    <div
      role="alert"
      className={`rounded-sm border border-tape-sell/50 bg-tape-sell/10 px-2 py-1.5 text-tape-sell ${className}`}
    >
      {describe(error)}
    </div>
  )
}

function describe(error: unknown): ReactElement | string {
  if (!(error instanceof ApiRequestError)) {
    return error instanceof Error ? error.message : 'Something went wrong'
  }

  const payload = error.payload

  switch (payload.code) {
    case 'VERSION_CONFLICT':
      return (
        <>
          <strong>Changed by someone else.</strong> You were editing version{' '}
          {payload.details.expectedVersion} of {payload.details.tradeId}, which is now at version{' '}
          {payload.details.currentVersion}. The blotter has the current values: check them and amend
          again.
        </>
      )

    case 'INVALID_STATE':
      return `${payload.details.tradeId} is ${payload.details.status} and cannot be changed.`

    case 'VALIDATION_FAILED':
      return (
        <>
          <strong>The server rejected this.</strong>
          <ul className="mt-0.5 list-inside list-disc">
            {payload.details.issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                {issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`}
              </li>
            ))}
          </ul>
        </>
      )

    case 'NOT_FOUND':
    case 'INTERNAL':
      return payload.message

    default: {
      // A new error code without a message for the user fails to compile here.
      const unreachable: never = payload
      return unreachable
    }
  }
}
