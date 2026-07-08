import type { Message } from '@nylas-labs/cli-kit/v3'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMounted } from './ClientTime.js'
import { sanitizeEmailHtml } from './sanitize-email.js'
import { messageBodyParagraphs, messageHasHtml } from './ui-model.js'

export function MessageBody({ message }: { message: Message }) {
	const mounted = useMounted()

	if (messageHasHtml(message)) {
		const plain = messageBodyParagraphs(message)
		if (!mounted) {
			return plain.length > 0 ? <PlainBody paragraphs={plain} /> : null
		}
		/* v8 ignore next -- `?? ''` is unreachable: this branch only runs when messageHasHtml() confirmed message.body is a non-empty string */
		return <HtmlMessageBody html={sanitizeEmailHtml(message.body ?? '')} messageId={message.id} />
	}

	const paragraphs = messageBodyParagraphs(message)
	if (paragraphs.length === 0) return null

	return <PlainBody paragraphs={paragraphs} />
}

function PlainBody({ paragraphs }: { paragraphs: string[] }) {
	return (
		<div className="space-y-3 text-[0.9375rem] leading-[1.7] text-foreground">
			{paragraphs.map((paragraph) => (
				<p key={paragraph.slice(0, 48)} className="whitespace-pre-line text-pretty">
					{paragraph}
				</p>
			))}
		</div>
	)
}

function HtmlMessageBody({ html, messageId }: { html: string; messageId: string }) {
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const [height, setHeight] = useState(80)
	const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

	useEffect(() => {
		const root = document.documentElement
		const update = () => setIsDark(root.classList.contains('dark'))
		update()
		const observer = new MutationObserver(update)
		observer.observe(root, { attributes: true, attributeFilter: ['class'] })
		return () => observer.disconnect()
	}, [])

	const resize = useCallback(() => {
		const doc = iframeRef.current?.contentDocument
		const root = doc?.documentElement
		if (!root) return
		const next = Math.max(root.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0)
		if (next > 0) setHeight(next)
	}, [])

	return (
		<iframe
			ref={iframeRef}
			title={`Email content ${messageId}`}
			sandbox="allow-same-origin"
			srcDoc={wrapEmailDocument(html, isDark)}
			className="w-full border-0 bg-transparent"
			style={{ height, display: 'block' }}
			onLoad={resize}
		/>
	)
}

function wrapEmailDocument(bodyHtml: string, isDark: boolean): string {
	const bg = isDark ? '#0a0a0a' : '#ffffff'
	const fg = isDark ? '#e8e8e8' : '#171717'
	const muted = isDark ? '#a3a3a3' : '#525252'
	const link = isDark ? '#93c5fd' : '#2563eb'
	const quote = isDark ? '#404040' : '#d4d4d4'

	return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}
body{margin:0;padding:0;font:15px/1.7 ui-sans-serif,system-ui,sans-serif;color:${fg};background:${bg};word-wrap:break-word;overflow-wrap:anywhere}
p{margin:0 0 1em}
p:last-child{margin-bottom:0}
img{max-width:100%;height:auto}
a{color:${link}}
table{max-width:100%}
blockquote{margin:0 0 0 .75rem;padding-left:.75rem;border-left:2px solid ${quote};color:${muted}}
</style></head><body>${bodyHtml}</body></html>`
}
