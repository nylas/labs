import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Test-only colour maths for checking the contrast of token and derived colours. */
export type Lab = { l: number; a: number; b: number }

/** Parses `oklch(L C H)`; other syntaxes (alpha, var()) are a test error. */
export function parseOklch(value: string): Lab {
	const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value.trim())
	if (!match) throw new Error(`Not a plain oklch() colour: ${value}`)
	const [l, c, h] = [Number(match[1]), Number(match[2]), (Number(match[3]) * Math.PI) / 180]
	return { l, a: c * Math.cos(h), b: c * Math.sin(h) }
}

/** `color-mix(in oklab, first <share>, second)`. */
export function mixOklab(first: Lab, second: Lab, share: number): Lab {
	return {
		l: first.l * share + second.l * (1 - share),
		a: first.a * share + second.a * (1 - share),
		b: first.b * share + second.b * (1 - share),
	}
}

/** WCAG relative luminance, clipping out-of-gamut channels the way a display does. */
export function luminance({ l, a, b }: Lab): number {
	const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
	const clip = (channel: number) => Math.min(1, Math.max(0, channel))
	return (
		0.2126 * clip(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short) +
		0.7152 * clip(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short) +
		0.0722 * clip(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short)
	)
}

export function contrast(first: Lab, second: Lab): number {
	const [high, low] = [luminance(first), luminance(second)].sort((x, y) => y - x) as [number, number]
	return (high + 0.05) / (low + 0.05)
}

/** Reads one custom property from the `:root` (light) or `.dark` block of `src/tokens.css`. */
export function token(name: string, theme: 'light' | 'dark'): string {
	const css = readFileSync(fileURLToPath(new URL('../src/tokens.css', import.meta.url)), 'utf8')
	const block = new RegExp(`${theme === 'light' ? ':root' : '\\.dark'} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
	const value = new RegExp(`\\s${name}: ([^;]+);`).exec(block)?.[1]
	if (!value) throw new Error(`Token ${name} is missing from the ${theme} theme`)
	return value
}
