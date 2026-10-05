import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { withRequestDiagnostics } from '#server/request-context'

const diagnostics = createMiddleware().server(({ next }) => withRequestDiagnostics(async () => next()))

// Defining custom request middleware replaces Start's default list. Retain its
// same-origin protection for server functions alongside request instrumentation.
const csrf = createCsrfMiddleware({ filter: (context) => context.handlerType === 'serverFn' })

export const startInstance = createStart(() => ({ requestMiddleware: [diagnostics, csrf] }))
