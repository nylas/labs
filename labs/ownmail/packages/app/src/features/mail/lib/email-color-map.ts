/**
 * Pure color decisions for OwnMail's dark email reader. The renderer reads
 * computed sender colors and asks this module how each one should be painted on
 * the app's dark ground. Nothing here touches the DOM, so every rule is unit
 * testable on the server.
 *
 * Colors are compared and adjusted in OKLCH so that lightness changes keep the
 * sender's hue, and brand colors keep their identity instead of drifting the way
 * a filter-based `invert(1) hue-rotate(180deg)` treatment does.
 */

export interface RgbColor {
	alpha: number
	blue: number
	green: number
	red: number
}

export interface OklchColor {
	chroma: number
	hue: number
	lightness: number
}

/**
 * How a message's colors are presented.
 * - `remap`: light-only mail, adapted color by color for the dark ground.
 * - `paper`: mail whose artwork carries a light matte; kept light, full bleed.
 * - `native`: mail that ships its own dark stylesheet; the sender's dark design.
 * - `original`: untouched sender colors (light app theme or reader's choice).
 */
export type EmailColorStrategy = 'remap' | 'paper' | 'native' | 'original'

/** Minimum WCAG contrast the remap keeps for text against its new surface. */
export const MIN_TEXT_CONTRAST = 4.5

const NEUTRAL_CHROMA = 0.035
const DEGREES = Math.PI / 180

/** OwnMail's dark `--background` token (`oklch(0.12 0.006 165)`), in sRGB. */
export const DARK_READER_GROUND: RgbColor = fromOklch({ lightness: 0.12, chroma: 0.006, hue: 165 * DEGREES })

/** The light canvas email is authored for when a sender paints none. */
export const DEFAULT_EMAIL_CANVAS: RgbColor = { red: 255, green: 255, blue: 255, alpha: 1 }

/** Parse a computed `rgb()`/`rgba()` value; any other syntax is reported as unknown. */
export function parseComputedColor(value: string): RgbColor | null {
	const match = value.match(
		/^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+)(%?))?\s*\)$/i,
	)
	if (!match) return null
	const [red, green, blue, alpha = '1', percent] = match.slice(1)
	/* v8 ignore next -- the expression requires all three captured RGB channels -- @preserve */
	if (red === undefined || green === undefined || blue === undefined) return null
	const parsedAlpha = Number(alpha) / (percent ? 100 : 1)
	return {
		red: Math.min(255, Number(red)),
		green: Math.min(255, Number(green)),
		blue: Math.min(255, Number(blue)),
		alpha: Math.min(1, parsedAlpha),
	}
}

export function formatRgb(color: RgbColor): string {
	return `rgb(${Math.round(color.red)}, ${Math.round(color.green)}, ${Math.round(color.blue)})`
}

/** Painted colors within a small per-channel tolerance are the same surface. */
export function sameColor(first: RgbColor, second: RgbColor): boolean {
	return (
		Math.abs(first.red - second.red) +
			Math.abs(first.green - second.green) +
			Math.abs(first.blue - second.blue) <
		10
	)
}

export function compositeColor(foreground: RgbColor, background: RgbColor): RgbColor {
	const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha)
	if (alpha === 0) return foreground
	const channel = (top: number, bottom: number) =>
		(top * foreground.alpha + bottom * background.alpha * (1 - foreground.alpha)) / alpha
	return {
		red: channel(foreground.red, background.red),
		green: channel(foreground.green, background.green),
		blue: channel(foreground.blue, background.blue),
		alpha,
	}
}

function linearChannel(value: number): number {
	const normalized = value / 255
	return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function encodedChannel(value: number): number {
	const clamped = Math.max(0, Math.min(1, value))
	const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055
	return Math.round(encoded * 255)
}

export function relativeLuminance(color: RgbColor): number {
	return (
		linearChannel(color.red) * 0.2126 +
		linearChannel(color.green) * 0.7152 +
		linearChannel(color.blue) * 0.0722
	)
}

export function contrastRatio(first: RgbColor, second: RgbColor): number {
	const firstLuminance = relativeLuminance(first)
	const secondLuminance = relativeLuminance(second)
	return (
		(Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05)
	)
}

export function toOklch(color: RgbColor): OklchColor {
	const red = linearChannel(color.red)
	const green = linearChannel(color.green)
	const blue = linearChannel(color.blue)
	const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
	const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
	const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
	const lightness = 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short
	const a = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short
	const b = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short
	return { lightness, chroma: Math.hypot(a, b), hue: Math.atan2(b, a) }
}

/** Convert OKLCH to sRGB, reducing chroma until the color fits the sRGB gamut. */
export function fromOklch({ lightness, chroma, hue }: OklchColor): RgbColor {
	let currentChroma = chroma
	for (;;) {
		const a = currentChroma * Math.cos(hue)
		const b = currentChroma * Math.sin(hue)
		const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
		const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
		const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
		const red = 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short
		const green = -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short
		const blue = -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short
		const inGamut = [red, green, blue].every((channel) => channel >= -0.0005 && channel <= 1.0005)
		if (inGamut || currentChroma < 0.002) {
			return { red: encodedChannel(red), green: encodedChannel(green), blue: encodedChannel(blue), alpha: 1 }
		}
		currentChroma *= 0.92
	}
}

function isNeutral(color: OklchColor): boolean {
	return color.chroma < NEUTRAL_CHROMA
}

/** Elevated dark surface used for light neutral cards, matched to the app's card tokens. */
function darkSurface(lightness: number): RgbColor {
	return fromOklch({ lightness, chroma: 0.007, hue: 165 * DEGREES })
}

/**
 * Map a painted non-canvas background onto the dark reader. Light neutral cards
 * become an elevated surface whose lift preserves the sender's light ordering;
 * pale tints become a tinted dark surface with the same hue; dark sections and
 * saturated brand fills (buttons, banners) keep their exact color.
 */
export function remapSurfaceColor(color: RgbColor): RgbColor {
	const oklch = toOklch(color)
	if (isNeutral(oklch)) {
		if (oklch.lightness < 0.6) return color
		return darkSurface(Math.min(0.185 + (1 - oklch.lightness) * 1.1, 0.3))
	}
	if (oklch.lightness > 0.85)
		return fromOklch({ lightness: 0.28, chroma: Math.min(oklch.chroma, 0.05), hue: oklch.hue })
	return color
}

/**
 * Choose a text color for its remapped surface. Authored colors are kept when
 * their surface did not change and they already read well. Otherwise neutral
 * text flips to a light value that preserves the sender's emphasis ordering,
 * colored text keeps its hue, and lightness rises only as far as contrast needs.
 */
export function remapTextColor(color: RgbColor, previousSurface: RgbColor, nextSurface: RgbColor): RgbColor {
	const opaque = color.alpha < 1 ? compositeColor(color, previousSurface) : color
	const surfaceChanged = !sameColor(previousSurface, nextSurface)
	if (!surfaceChanged && contrastRatio(opaque, nextSurface) >= MIN_TEXT_CONTRAST) return color
	const oklch = toOklch(opaque)
	const surfaceIsDark = toOklch(nextSurface).lightness < 0.5
	let lightness = oklch.lightness
	if (surfaceIsDark && isNeutral(oklch)) lightness = Math.max(0.95 - oklch.lightness * 0.35, oklch.lightness)
	let candidate = fromOklch({ lightness, chroma: oklch.chroma, hue: oklch.hue })
	const step = surfaceIsDark ? 0.02 : -0.02
	while (contrastRatio(candidate, nextSurface) < MIN_TEXT_CONTRAST && lightness > 0 && lightness < 1) {
		lightness = Math.max(0, Math.min(1, lightness + step))
		candidate = fromOklch({ lightness, chroma: oklch.chroma, hue: oklch.hue })
	}
	return candidate
}

/** Light hairlines become a visible dark-mode hairline; darker strokes stay as authored. */
export function remapBorderColor(color: RgbColor, nextSurface: RgbColor): RgbColor | null {
	const oklch = toOklch(color)
	if (color.alpha === 0 || oklch.lightness < 0.6) return null
	if (isNeutral(oklch)) return darkSurface(Math.min(toOklch(nextSurface).lightness + 0.13, 0.4))
	return fromOklch({ lightness: 0.45, chroma: oklch.chroma, hue: oklch.hue })
}

/** Decide how a message's colors are presented in the current app theme. */
export function chooseEmailColorStrategy({
	theme,
	colorMode,
	senderDarkStyles,
	lightMatteArtwork,
}: {
	theme: 'dark' | 'light'
	colorMode: 'automatic' | 'original'
	senderDarkStyles: boolean
	lightMatteArtwork: boolean
}): EmailColorStrategy {
	if (theme === 'light' || colorMode === 'original') return 'original'
	if (senderDarkStyles) return 'native'
	if (lightMatteArtwork) return 'paper'
	return 'remap'
}

/**
 * Does a downsampled image border look like a light matte that would read as a
 * white box on the dark ground? `pixels` is RGBA data for a `width`×`height`
 * sample; only the outer two-pixel ring is inspected.
 */
export function pixelsHaveLightMatte(
	pixels: ArrayLike<number>,
	width: number,
	height: number,
	canvas: RgbColor,
): boolean {
	if (width < 5 || height < 5 || toOklch(canvas).lightness < 0.9) return false
	let ring = 0
	let matte = 0
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			if (x > 1 && x < width - 2 && y > 1 && y < height - 2) continue
			const offset = (y * width + x) * 4
			ring += 1
			const pixel = {
				red: pixels[offset] ?? 0,
				green: pixels[offset + 1] ?? 0,
				blue: pixels[offset + 2] ?? 0,
				alpha: (pixels[offset + 3] ?? 0) / 255,
			}
			if (pixel.alpha > 0.96 && sameColor(pixel, canvas)) matte += 1
		}
	}
	return matte / ring > 0.8
}
