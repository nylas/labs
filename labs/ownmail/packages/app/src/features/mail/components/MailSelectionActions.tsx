import { createContext, type ReactNode, useContext, useState } from 'react'

const ActiveContext = createContext(false)
const ActionsContext = createContext<ReactNode>(null)
const SetActionsContext = createContext<(actions: ReactNode) => void>(() => {})

/** One shared mobile surface; a selecting list temporarily supplies its actions. */
export function MailSelectionActionsProvider({ children }: { children: ReactNode }) {
	const [actions, setActions] = useState<ReactNode>(null)
	return (
		<SetActionsContext value={setActions}>
			<ActionsContext value={actions}>
				<ActiveContext value={Boolean(actions)}>{children}</ActiveContext>
			</ActionsContext>
		</SetActionsContext>
	)
}

export function useMailSelectionActions() {
	return useContext(ActionsContext)
}

export function useSetMailSelectionActions() {
	return useContext(SetActionsContext)
}

export function useHasMailSelectionActions() {
	return useContext(ActiveContext)
}
