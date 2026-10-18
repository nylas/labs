/**
 * Member counts of the local mock app's mailing lists, keyed by lower-case
 * address: board 05's details panel reads "pm-leads@ · 12". No provider
 * reports a list's size, so real mail has none and its list chips show the
 * list without a count.
 */
export const DEV_MOCK_LIST_SIZES: Readonly<Record<string, number>> = { 'pm-leads@vercel.com': 12 }
