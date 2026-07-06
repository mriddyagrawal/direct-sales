// "Keep me signed in — ~30 DAYS ON THIS PHONE" (S1 login spec) is checked by
// default and, for this foundation milestone, applied globally rather than
// wired as a shorter-vs-longer session toggle — the primary persona (a
// field salesman) wants to stay signed in on their own phone. Shared across
// the browser/server/middleware clients so all three agree on session
// lifetime.
export const SUPABASE_COOKIE_OPTIONS = {
  maxAge: 60 * 60 * 24 * 30, // 30 days
};
