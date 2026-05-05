<script>
	import { onMount } from 'svelte';
	import CanvasBoard from '$lib/components/CanvasBoard.svelte';
	import DockNav from '$lib/components/DockNav.svelte';
	import LetterView from '$lib/components/LetterView.svelte';
	import { getSession, hasSupabaseConfig, onAuthChange, signInWithPassword, signOut } from '$lib/services/supabaseClient';

	let activeView = 'canvas';
	let authSession = null;
	let authUsername = '';
	let authPassword = '';
	let authError = '';
	let isCheckingAuth = true;
	let isAuthBusy = false;

	$: isSignedIn = Boolean(authSession?.user);
	$: isLoginDisabled = isCheckingAuth || isAuthBusy || !hasSupabaseConfig;

	const dateText = new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric'
	}).format(new Date());

	function handleDockSelect(event) {
		activeView = event.detail;
	}

	onMount(() => {
		const unsubscribeAuth = onAuthChange((session) => {
			authSession = session;

			if (session?.user) {
				authError = '';
			}
		});

		async function loadSession() {
			try {
				authSession = await getSession();
			} catch (error) {
				console.warn('Unable to read Supabase session', error);
				authError = 'Unable to check your login. Try signing in again.';
			} finally {
				isCheckingAuth = false;
			}
		}

		void loadSession();

		return unsubscribeAuth;
	});

	async function handleLoginSubmit() {
		const username = authUsername.trim();
		if (!username || !authPassword || isLoginDisabled) return;

		isAuthBusy = true;
		authError = '';

		try {
			const { data, error } = await signInWithPassword(username, authPassword);

			if (error) {
				throw error;
			}

			authSession = data.session;
			authPassword = '';
			activeView = 'canvas';
		} catch (error) {
			console.error('Supabase sign-in failed', error);
			authError = error?.message ?? 'Unable to sign in.';
		} finally {
			isAuthBusy = false;
		}
	}

	async function handleLogout() {
		isAuthBusy = true;
		authError = '';

		try {
			await signOut();
			authSession = null;
			activeView = 'canvas';
			authPassword = '';
		} catch (error) {
			console.error('Supabase sign-out failed', error);
			authError = error?.message ?? 'Unable to log out.';
		} finally {
			isAuthBusy = false;
		}
	}
</script>

<svelte:head>
	<title>For Alejandra</title>
</svelte:head>

{#if isSignedIn}
	<main class="app-shell" class:canvas-view={activeView === 'canvas'}>
		<button type="button" class="logout-button" disabled={isAuthBusy} on:click={handleLogout}>Logout</button>

		<header class="date-header" aria-label="Today">
			<p>Today is</p>
			<h1>{dateText}</h1>
			{#if activeView !== 'canvas'}
				<span>Cake, music, a letter, and five memory pins.</span>
			{/if}
		</header>

		<section class="view-stage" aria-live="polite">
			{#if activeView === 'canvas'}
				<CanvasBoard {authSession} />
			{:else}
				<LetterView />
			{/if}
		</section>

		<DockNav active={activeView} on:select={handleDockSelect} />
	</main>
{:else}
	<main class="login-screen">
		<form class="login-panel" aria-label="Login" on:submit|preventDefault={handleLoginSubmit}>
			<div class="login-copy">
				<h1 aria-label="Aniket Loves Alejandra">
					<span>Aniket</span>
					<span class="love-word">Loves</span>
					<span>Alejandra</span>
				</h1>
			</div>

			<label class="sr-only" for="auth-username">Username</label>
			<input id="auth-username" type="text" bind:value={authUsername} autocomplete="username" placeholder="username" disabled={isLoginDisabled} required />

			<label class="sr-only" for="auth-password">Password</label>
			<input id="auth-password" type="password" bind:value={authPassword} autocomplete="current-password" placeholder="password" disabled={isLoginDisabled} required />

			<button type="submit" class="login-button" disabled={isLoginDisabled}>{isAuthBusy ? 'Signing in...' : 'Login'}</button>

			{#if !hasSupabaseConfig}
				<p class="auth-error">Login is not configured.</p>
			{:else if authError}
				<p class="auth-error">{authError}</p>
			{/if}
		</form>
	</main>
{/if}

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(html) {
		min-height: 100%;
		background: #ffeaf3;
	}

	:global(body) {
		min-height: 100%;
		margin: 0;
		font-family:
			Inter,
			ui-sans-serif,
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
		color: #542139;
		background:
			radial-gradient(circle at 18% 8%, rgba(255, 255, 255, 0.95), transparent 18rem),
			radial-gradient(circle at 82% 10%, rgba(196, 167, 255, 0.34), transparent 22rem),
			radial-gradient(circle at 50% 92%, rgba(255, 111, 160, 0.2), transparent 22rem),
			linear-gradient(135deg, #fff7fb 0%, #ffe4ef 45%, #f9edff 100%);
	}

	:global(button),
	:global(input) {
		font-family: inherit;
	}

	.app-shell {
		position: relative;
		isolation: isolate;
		min-height: 100svh;
		padding: clamp(1rem, 2.5vw, 2rem) clamp(1rem, 4vw, 3rem) 8.5rem;
	}

	.login-screen {
		position: relative;
		isolation: isolate;
		display: grid;
		place-items: center;
		min-height: 100svh;
		padding: clamp(1rem, 4vw, 3rem);
	}

	.login-screen::before,
	.login-screen::after,

	.app-shell::before,
	.app-shell::after {
		content: '';
		position: fixed;
		z-index: -1;
		border-radius: 999px;
		filter: blur(4px);
		opacity: 0.7;
		pointer-events: none;
	}

	.login-screen::before {
		top: 11%;
		left: -4rem;
		width: 17rem;
		height: 17rem;
		background: rgba(255, 162, 196, 0.3);
	}

	.login-screen::after {
		right: -4rem;
		bottom: 12%;
		width: 15rem;
		height: 15rem;
		background: rgba(181, 142, 255, 0.26);
	}

	.app-shell::before {
		top: 16%;
		left: -5rem;
		width: 16rem;
		height: 16rem;
		background: rgba(255, 162, 196, 0.32);
	}

	.app-shell::after {
		right: -4rem;
		bottom: 15%;
		width: 14rem;
		height: 14rem;
		background: rgba(181, 142, 255, 0.28);
	}

	.login-panel {
		position: relative;
		z-index: 1;
		display: grid;
		gap: 0.78rem;
		width: min(23rem, 100%);
		padding: clamp(1.1rem, 5vw, 1.6rem);
		border: 1px solid rgba(255, 255, 255, 0.74);
		border-radius: 1.15rem;
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.86), rgba(255, 226, 240, 0.9));
		box-shadow: 0 20px 54px rgba(150, 44, 92, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(24px) saturate(1.35);
	}

	.login-copy {
		display: grid;
		gap: 0.2rem;
		padding-bottom: 0.2rem;
		text-align: center;
	}

	.login-copy h1 {
		display: grid;
		gap: 0.08rem;
		margin: 0;
		color: #5a2039;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: clamp(2.15rem, 10vw, 3.55rem);
		font-weight: 500;
		line-height: 0.96;
		letter-spacing: 0;
		text-wrap: balance;
		text-shadow: 0 10px 28px rgba(130, 42, 82, 0.1);
	}

	.login-copy h1 span {
		display: block;
	}

	.love-word {
		color: #b84d78;
		font-size: 0.62em;
		font-style: italic;
		font-weight: 400;
		line-height: 1.18;
	}

	.login-panel input {
		width: 100%;
		min-width: 0;
		padding: 0.76rem 0.86rem;
		border: 1px solid rgba(151, 71, 255, 0.18);
		border-radius: 0.75rem;
		color: #5f2139;
		background: rgba(255, 255, 255, 0.92);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
		font-size: 0.92rem;
		font-weight: 760;
	}

	.login-panel input:focus {
		border-color: rgba(255, 95, 159, 0.54);
		outline: 3px solid rgba(255, 95, 159, 0.22);
	}

	.login-button,
	.logout-button {
		border: 0;
		border-radius: 999px;
		color: #fff;
		background: linear-gradient(135deg, #ff5f9f, #9d6bff);
		box-shadow: 0 12px 24px rgba(111, 39, 78, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.45);
		font: inherit;
		font-weight: 900;
		cursor: pointer;
		transition: transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
	}

	.login-button {
		width: 100%;
		padding: 0.78rem 1rem;
		font-size: 0.9rem;
	}

	.logout-button {
		position: fixed;
		top: clamp(0.72rem, 2vw, 1rem);
		right: clamp(0.72rem, 2vw, 1rem);
		z-index: 60;
		padding: 0.38rem 0.62rem;
		font-size: 0.72rem;
		line-height: 1;
	}

	.login-button:hover,
	.login-button:focus-visible,
	.logout-button:hover,
	.logout-button:focus-visible {
		transform: translateY(-1px);
		box-shadow: 0 16px 30px rgba(111, 39, 78, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.45);
		outline: none;
	}

	.login-button:disabled,
	.logout-button:disabled,
	.login-panel input:disabled {
		cursor: wait;
		opacity: 0.62;
	}

	.auth-error {
		margin: 0;
		color: #c42f62;
		font-size: 0.78rem;
		font-weight: 800;
		line-height: 1.35;
		text-align: center;
	}

	.date-header {
		position: relative;
		z-index: 20;
		display: grid;
		justify-items: center;
		gap: 0.22rem;
		max-width: 58rem;
		margin: 0 auto clamp(1rem, 3vw, 1.6rem);
		text-align: center;
	}

	.date-header p {
		margin: 0;
		color: #ff5f9f;
		font-size: 0.76rem;
		font-weight: 950;
		letter-spacing: 0.24em;
		text-transform: uppercase;
	}

	.date-header h1 {
		margin: 0;
		color: #5f2139;
		font-size: clamp(2.3rem, 7vw, 6.5rem);
		font-weight: 950;
		line-height: 0.92;
		letter-spacing: -0.055em;
		text-wrap: balance;
		text-shadow: 0 12px 32px rgba(130, 42, 82, 0.12);
	}

	.date-header span {
		max-width: 44rem;
		color: #8a4a63;
		font-size: clamp(0.98rem, 2vw, 1.18rem);
		font-weight: 750;
		line-height: 1.5;
	}

	.view-stage {
		position: relative;
		z-index: 10;
		max-width: 1220px;
		margin: 0 auto;
	}

	.canvas-view .date-header {
		pointer-events: none;
	}

	.canvas-view .view-stage {
		z-index: 0;
		max-width: none;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	@media (max-width: 720px) {
		.app-shell {
			padding-inline: 0.75rem;
			padding-bottom: 7.5rem;
		}
	}
</style>
