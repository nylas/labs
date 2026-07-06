import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { RecipientInput } from '../components/RecipientInput.js'
import { getDraft, saveDraft, sendMessage } from '../server/fns.js'
import { ErrorBanner } from './mail.f.$folderId.t.$threadId.js'

export const Route = createFileRoute('/mail/compose')({
	validateSearch: (search): { draft?: string } =>
		typeof search.draft === 'string' ? { draft: search.draft } : {},
	loaderDeps: ({ search }) => ({ draft: search.draft }),
	loader: async ({ deps }) => {
		if (!deps.draft) return null
		return getDraft({ data: { draftId: deps.draft } })
	},
	component: Compose,
})

function Compose() {
	const draft = Route.useLoaderData()
	const navigate = useNavigate()
	const [draftId, setDraftId] = useState<string | undefined>(draft?.id)
	const [to, setTo] = useState(draft?.to?.map((p) => p.email).join(', ') ?? '')
	const [subject, setSubject] = useState(draft?.subject ?? '')
	const [body, setBody] = useState(draft?.body ?? '')
	const [busy, setBusy] = useState(false)
	const [savedAt, setSavedAt] = useState<number | null>(null)
	const [error, setError] = useState<string | null>(null)
	const dirty = useRef(false)

	// Autosave a draft 3s after the last edit.
	useEffect(() => {
		dirty.current = true
		const timer = setTimeout(async () => {
			if (!dirty.current || (!to && !subject && !body)) return
			try {
				const saved = await saveDraft({ data: { ...(draftId ? { draftId } : {}), to, subject, body } })
				setDraftId(saved.draftId)
				setSavedAt(Date.now())
				dirty.current = false
			} catch {
				// autosave is best-effort
			}
		}, 3000)
		return () => clearTimeout(timer)
	}, [to, subject, body, draftId])

	async function submit() {
		setBusy(true)
		setError(null)
		try {
			await sendMessage({ data: { to, subject, body: body.replaceAll('\n', '<br>') } })
			navigate({ to: '/mail/f/$folderId', params: { folderId: 'sent' } })
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to send')
			setBusy(false)
		}
	}

	return (
		<div className="mx-auto max-w-2xl overflow-y-auto px-6 py-6">
			<div className="mb-4 flex items-baseline justify-between">
				<h1 className="text-xl font-semibold tracking-tight">New message</h1>
				{savedAt ? <span className="text-xs text-neutral-400">Draft saved</span> : null}
			</div>
			<div className="space-y-3">
				<RecipientInput value={to} onChange={setTo} />
				<input
					value={subject}
					onChange={(e) => setSubject(e.target.value)}
					placeholder="Subject"
					className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
				/>
				<textarea
					value={body}
					onChange={(e) => setBody(e.target.value)}
					rows={12}
					placeholder="Write your message…"
					className="w-full resize-y rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
				/>
				{error ? <ErrorBanner message={error} /> : null}
				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={() => history.back()}
						className="rounded-full px-5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
					>
						Close
					</button>
					<button
						type="button"
						disabled={busy || to.trim() === ''}
						onClick={submit}
						className="rounded-full bg-blue-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{busy ? 'Sending…' : 'Send'}
					</button>
				</div>
			</div>
		</div>
	)
}
