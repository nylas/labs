import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names the shadcn way: `clsx` resolves conditionals/arrays, then
 * `tailwind-merge` de-duplicates conflicting Tailwind utilities so the last one
 * wins (e.g. `px-2 px-4` -> `px-4`). Shared by the app and the ui/ primitives.
 */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs))
}
