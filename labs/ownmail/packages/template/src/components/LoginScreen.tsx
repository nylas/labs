import { ArrowRight, Calendar, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { type ReactNode, useState } from 'react'

export function LoginScreen({ signInHref }: { signInHref: string }) {
	const [connecting, setConnecting] = useState(false)

	function handleSignIn() {
		if (connecting) return
		setConnecting(true)
		window.setTimeout(() => {
			window.location.assign(signInHref)
		}, 900)
	}

	return (
		<main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4 py-10">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,color-mix(in_oklch,var(--accent),transparent_70%),transparent_50%)]"
			/>
			<div className="relative z-10 w-full max-w-md">
				<div className="mb-8 flex flex-col items-center text-center">
					<div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
						<span className="font-display text-2xl leading-none font-extrabold">o</span>
					</div>
					<h1 className="mt-5 font-display text-3xl font-extrabold tracking-tight text-foreground text-balance">
						Welcome to ownmail
					</h1>
					<p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
						Your inbox and calendar in one focused workspace.
					</p>
				</div>

				<div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
					<div className="mb-6 flex flex-col gap-3">
						<Feature icon={<Mail className="h-4 w-4" />} label="Unified mail with fast search" />
						<Feature icon={<Calendar className="h-4 w-4" />} label="Calendar and events, side by side" />
						<Feature
							icon={<ShieldCheck className="h-4 w-4" />}
							label="Secure sign-in through your provider"
						/>
					</div>

					<button
						type="button"
						onClick={handleSignIn}
						disabled={connecting}
						className="group flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
					>
						{connecting ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin" />
								Connecting to your provider…
							</>
						) : (
							<>
								Sign in to continue
								<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
							</>
						)}
					</button>

					<p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">
						You&apos;ll be redirected to your identity provider to authenticate securely.
					</p>
				</div>

				<p className="mt-6 text-center text-xs text-muted-foreground">
					By continuing you agree to the Terms of Service and Privacy Policy.
				</p>
			</div>
		</main>
	)
}

function Feature({ icon, label }: { icon: ReactNode; label: string }) {
	return (
		<div className="flex items-center gap-3 text-sm text-foreground/85">
			<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground">
				{icon}
			</span>
			{label}
		</div>
	)
}
