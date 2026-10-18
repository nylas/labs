/**
 * Links in a message whose sender failed authentication or imitates someone
 * the mailbox knows do nothing (design.md "Edge states"). Cancelling clicks is
 * not enough: a context menu, a long press or a drag would still carry a live
 * URL. So the destination leaves the link entirely and only its words stay.
 * (The address is not kept anywhere else in the markup either: the sanitizer
 * reads any URL in an attribute as a remote resource and would strip it, and
 * report the message as having hidden images.)
 */

const LINK_SELECTOR = 'a, area'
const LINK_ATTRIBUTES = ['href', 'xlink:href', 'ping', 'target'] as const

/** Make every link under `root` inert in place. */
export function disableLinks(root: Pick<ParentNode, 'querySelectorAll'>): void {
	for (const link of root.querySelectorAll(LINK_SELECTOR)) {
		for (const attribute of LINK_ATTRIBUTES) link.removeAttribute(attribute)
	}
}

/** A message document with every link made inert. */
export function inertLinksHtml(html: string): string {
	const document = new DOMParser().parseFromString(html, 'text/html')
	disableLinks(document)
	return `<!doctype html>${document.documentElement.outerHTML}`
}
