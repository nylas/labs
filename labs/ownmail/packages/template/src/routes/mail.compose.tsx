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
		<div className="compose-surface mail-main-full">
			<div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
				<div>
					<h1 className="thread-title m-0">New message</h1>
					<p className="muted-line">Autosaves while you write.</p>
				</div>
				{savedAt ? <span className="badge">Draft saved</span> : null}
			</div>
			<div className="compose-card space-y-3">
				<RecipientInput value={to} onChange={setTo} />
				<input
					value={subject}
					onChange={(e) => setSubject(e.target.value)}
					placeholder="Subject"
					className="app-input"
					aria-label="Subject"
				/>
				<textarea
					value={body}
					onChange={(e) => setBody(e.target.value)}
					rows={12}
					placeholder="Write your message…"
					className="app-textarea"
					aria-label="Message body"
				/>
				{error ? <ErrorBanner message={error} /> : null}
				<div className="flex justify-end gap-2">
					<button type="button" onClick={() => history.back()} className="btn btn-quiet">
						Close
					</button>
					<button
						type="button"
						disabled={busy || to.trim() === ''}
						onClick={submit}
						className="btn btn-primary"
					>
						{busy ? 'Sending…' : 'Send'}
					</button>
				</div>
			</div>
		</div>
	)
}
