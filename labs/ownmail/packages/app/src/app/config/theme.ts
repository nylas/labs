export const THEME_STORAGE_KEY = 'theme'
export const ROOT_BACKGROUND_CLASS = 'bg-background'
export const THEME_CHANGE_EVENT = 'ownmail:theme-change'

export function initialThemeIsDark(savedTheme: string | null): boolean {
	return savedTheme === 'dark'
}

export function themeClassName(isDark: boolean): 'dark' | 'light' {
	return isDark ? 'dark' : 'light'
}

export function applyThemeClass(isDark: boolean): void {
	const next = themeClassName(isDark)
	const previous = isDark ? 'light' : 'dark'
	document.documentElement.classList.add(ROOT_BACKGROUND_CLASS, next)
	document.documentElement.classList.remove(previous)
}

export function currentThemeIsDark(): boolean {
	return document.documentElement.classList.contains('dark')
}

export function setTheme(isDark: boolean): void {
	applyThemeClass(isDark)
	localStorage.setItem(THEME_STORAGE_KEY, themeClassName(isDark))
	window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
}

export function toggleTheme(): void {
	setTheme(!currentThemeIsDark())
}

export function subscribeToTheme(onChange: (isDark: boolean) => void): () => void {
	const handleChange = () => onChange(currentThemeIsDark())
	window.addEventListener(THEME_CHANGE_EVENT, handleChange)
	return () => window.removeEventListener(THEME_CHANGE_EVENT, handleChange)
}

export function rootThemeClassNames(isDark: boolean): string[] {
	return [ROOT_BACKGROUND_CLASS, themeClassName(isDark)]
}

export function themeToggleLabel(mounted: boolean, isDark: boolean): string {
	if (!mounted) return 'Toggle theme'
	return isDark ? 'Switch to light mode' : 'Switch to dark mode'
}

export const INITIAL_ROOT_CLASS_NAME = rootThemeClassNames(false).join(' ')
