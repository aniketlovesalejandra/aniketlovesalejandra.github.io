<script>
	import CanvasBoard from '$lib/components/CanvasBoard.svelte';
	import DockNav from '$lib/components/DockNav.svelte';
	import LetterView from '$lib/components/LetterView.svelte';

	let activeView = 'canvas';

	const dateText = new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric'
	}).format(new Date());

	function handleDockSelect(event) {
		activeView = event.detail;
	}
</script>

<svelte:head>
	<title>For Alejandra</title>
</svelte:head>

<main class="app-shell" class:canvas-view={activeView === 'canvas'}>
	<header class="date-header" aria-label="Today">
		<p>Today is</p>
		<h1>{dateText}</h1>
		<span>{activeView === 'canvas' ? 'Drag photos onto the page, write with the pen, or switch to the eraser.' : 'Cake, music, a letter, and five memory pins.'}</span>
	</header>

	<section class="view-stage" aria-live="polite">
		{#if activeView === 'canvas'}
			<CanvasBoard />
		{:else}
			<LetterView />
		{/if}
	</section>

	<DockNav active={activeView} on:select={handleDockSelect} />
</main>

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

	@media (max-width: 720px) {
		.app-shell {
			padding-inline: 0.75rem;
			padding-bottom: 7.5rem;
		}
	}
</style>
