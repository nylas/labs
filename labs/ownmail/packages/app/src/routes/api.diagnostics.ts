import { createFileRoute } from '@tanstack/react-router'
import { receiveBrowserDiagnostic } from '#server/browser-diagnostics'

export const Route = createFileRoute('/api/diagnostics')({
	server: { handlers: { POST: ({ request }) => receiveBrowserDiagnostic(request) } },
})
