import { zodResolver } from '@hookform/resolvers/zod'
import type { Credentials, Session } from '@tapedeck/shared'
import { credentials, DEMO_PASSWORD, PASSWORD_MIN_LENGTH } from '@tapedeck/shared'
import type { ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { ErrorNotice } from '../../components/ErrorNotice.js'
import { readTrader } from '../../lib/identity.js'
import { ACTION, CHIP, CONTROL, MICRO_LABEL } from '../../lib/ui.js'
import { INTENT_PENDING, INTENT_SUBMIT, INTENT_TITLE, type Intent } from './intent.js'
import { useAuth } from './useAuth.js'
import { Wordmark } from './Wordmark.js'

type Props = {
  intent: Intent
  onSignedIn: (session: Session) => void
  onBack: () => void
}

/** Lighter than the canvas it sits on, like the blotter's filter bar. */
const INPUT = `${CONTROL} w-full bg-tape-panel`

/** Both ways in. The mark is unfilled, because the submit button is this screen's
 *  one accent fill. */
export function AuthForm({ intent, onSignedIn, onBack }: Props): ReactElement {
  const auth = useAuth(intent, onSignedIn)

  const form = useForm<Credentials>({
    // The server parses the same schema, so the client cannot drift from it.
    resolver: zodResolver(credentials),
    // The name a handoff link asked for, so the demo's second window starts on
    // the trader it was sent as.
    defaultValues: { username: readTrader(), password: '' },
  })

  const { errors } = form.formState

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[42ch] flex-col justify-center gap-6 px-6 py-12">
      <Wordmark className="self-start text-3xl" filled={false} />

      {/* Wrapped, not passed: handleSubmit hands its handler the event as a second
          argument, which mutate would read as its options. */}
      <form
        className="flex flex-col gap-3"
        noValidate
        onSubmit={form.handleSubmit((values) => auth.mutate(values))}
      >
        <h2 className="text-base font-semibold">{INTENT_TITLE[intent]}</h2>

        <div>
          <label className={`mb-1 block ${MICRO_LABEL}`} htmlFor="username">
            Username
          </label>
          <input
            autoComplete="username"
            className={INPUT}
            id="username"
            {...form.register('username')}
          />
          {errors.username ? (
            <span className="mt-1 block text-[10px] text-tape-sell">{errors.username.message}</span>
          ) : null}
        </div>

        <div>
          <label className={`mb-1 block ${MICRO_LABEL}`} htmlFor="password">
            Password
          </label>
          <input
            autoComplete={intent === 'login' ? 'current-password' : 'new-password'}
            className={INPUT}
            id="password"
            type="password"
            {...form.register('password')}
          />
          {errors.password ? (
            <span className="mt-1 block text-[10px] text-tape-sell">{errors.password.message}</span>
          ) : null}
        </div>

        {auth.error ? <ErrorNotice error={auth.error} /> : null}

        <div className="mt-1 flex items-center gap-2">
          <button className={ACTION} disabled={auth.isPending} type="submit">
            {auth.isPending ? INTENT_PENDING[intent] : INTENT_SUBMIT[intent]}
          </button>
          <button className={CHIP} onClick={onBack} type="button">
            Back
          </button>
        </div>

        {/* Repeated from the landing page: whoever needs it is looking here. */}
        <p className="text-[11px] text-tape-muted">
          {intent === 'login'
            ? `Accounts are mocked. Every seeded trader's password is ${DEMO_PASSWORD}.`
            : `Accounts are mocked and live in memory, so a restart clears them. At least ${PASSWORD_MIN_LENGTH} characters.`}
        </p>
      </form>
    </main>
  )
}
