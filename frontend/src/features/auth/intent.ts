/** Which of the two things the form is doing. One component serves both: the same
 *  two fields, and two near-identical forms would drift. */
export type Intent = 'login' | 'register'

export const INTENT_TITLE: Record<Intent, string> = {
  login: 'Log in',
  register: 'Register',
}

/** The same verb as the button that opened the form, so the action keeps its
 *  name all the way through. */
export const INTENT_SUBMIT: Record<Intent, string> = {
  login: 'Log in',
  register: 'Create account',
}

export const INTENT_PENDING: Record<Intent, string> = {
  login: 'Logging in',
  register: 'Creating',
}
