import { createMiddleware, createStart } from '@tanstack/react-start'
import { withRequestDiagnostics } from '#server/request-context'

const diagnostics = createMiddleware().server(({ next }) => withRequestDiagnostics(async () => next()))

export const startInstance = createStart(() => ({ requestMiddleware: [diagnostics] }))
