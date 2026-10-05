/* Hallmark · navigation motion · Quiet · pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import { observeNavigationMotion } from '#app/lib/navigation-motion'

export function NavigationMotion() {
	const router = useRouter()
	useEffect(() => observeNavigationMotion(router), [router])
	return null
}
