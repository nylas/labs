import { createServerFn } from '@tanstack/react-start'
import { usingDevMocks } from '#server/platform'

/** The mock roadmap thread's latest message (`dev-mock-mail.fixture.ts`): its catch-up has a summary. */
export const DEV_MOCK_SUMMARY_MESSAGE_ID = 'msg-roadmap-14'

/** Board 04's three summary bullets for the mock roadmap thread. */
export const DEV_MOCK_THREAD_SUMMARY: readonly string[] = [
	'Alan asked for two changes: a firm date for calendar sync and search moved down.',
	'Grace made both in v4 and added Mary for launch dates.',
	'Open: Mary asks you to confirm legal sign-off by Oct 20.',
]

/**
 * The local mock app's catch-up summary. OwnMail has no assistant: this
 * answers only in mock mode (`OWNMAIL_DEV_MOCKS`), so the summary block can be
 * checked against the board, and is null everywhere else, real mail included.
 */
export const getDevMockThreadSummary = createServerFn({ method: 'GET' }).handler(
	async (): Promise<string[] | null> => ((await usingDevMocks()) ? [...DEV_MOCK_THREAD_SUMMARY] : null),
)
