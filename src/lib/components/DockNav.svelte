<script>
	import { createEventDispatcher } from 'svelte';

	export let active = 'canvas';

	const dispatch = createEventDispatcher();

	const dockItems = [
		{
			id: 'canvas',
			label: 'Open canvas',
			short: 'Canvas'
		},
		{
			id: 'letter',
			label: 'Open birthday cake letter',
			short: 'Cake'
		}
	];

	function selectView(view) {
		dispatch('select', view);
	}
</script>

<nav class="dock-shell" aria-label="Romantic site navigation">
	<div class="dock">
		{#each dockItems as item}
			<button
				type="button"
				class:active={active === item.id}
				class="dock-button"
				aria-label={item.label}
				aria-pressed={active === item.id}
				on:click={() => selectView(item.id)}
			>
				<span class="icon-wrap" aria-hidden="true">
					{#if item.id === 'canvas'}
						<svg viewBox="0 0 64 64" role="img">
							<rect x="10" y="12" width="44" height="38" rx="8" fill="#fff9fc" />
							<path d="M18 42c7-12 13-13 18-6 4 5 7 5 11-2" fill="none" stroke="#ff72a8" stroke-width="4" stroke-linecap="round" />
							<circle cx="44" cy="22" r="5" fill="#ffd166" />
							<path d="M14 52h36" stroke="#b388ff" stroke-width="4" stroke-linecap="round" />
						</svg>
					{:else}
						<svg viewBox="0 0 64 64" role="img">
							<path d="M18 30h28a8 8 0 0 1 8 8v12H10V38a8 8 0 0 1 8-8Z" fill="#ffc7da" />
							<path d="M14 36h36v6H14z" fill="#fff1f7" />
							<path d="M20 22h24a6 6 0 0 1 6 6v4H14v-4a6 6 0 0 1 6-6Z" fill="#fff9fc" />
							<path d="M32 9c4 4 4 7 0 11-4-4-4-7 0-11Z" fill="#ff9f1c" />
							<path d="M32 19v5" stroke="#6d3b47" stroke-width="3" stroke-linecap="round" />
							<circle cx="23" cy="30" r="2" fill="#ff72a8" />
							<circle cx="32" cy="30" r="2" fill="#b388ff" />
							<circle cx="41" cy="30" r="2" fill="#ff72a8" />
						</svg>
					{/if}
				</span>
				<span class="label">{item.short}</span>
			</button>
		{/each}
	</div>
</nav>

<style>
	.dock-shell {
		position: fixed;
		left: 0;
		right: 0;
		bottom: max(1rem, env(safe-area-inset-bottom));
		z-index: 40;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}

	.dock {
		display: flex;
		gap: 0.8rem;
		align-items: end;
		padding: 0.7rem;
		border: 1px solid rgba(255, 255, 255, 0.68);
		border-radius: 1.8rem;
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.58), rgba(255, 226, 240, 0.72));
		box-shadow: 0 24px 70px rgba(150, 44, 92, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(24px) saturate(1.5);
		pointer-events: auto;
	}

	.dock-button {
		position: relative;
		display: grid;
		place-items: center;
		width: clamp(4.4rem, 14vw, 5.4rem);
		height: clamp(4.4rem, 14vw, 5.4rem);
		padding: 0.45rem;
		border: 0;
		border-radius: 1.35rem;
		color: #64263c;
		background: linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(255, 236, 246, 0.92));
		box-shadow: 0 14px 35px rgba(145, 43, 94, 0.18), inset 0 1px 0 #fff;
		cursor: pointer;
		transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease;
	}

	.dock-button:hover,
	.dock-button:focus-visible {
		transform: translateY(-0.45rem) scale(1.08);
		box-shadow: 0 20px 45px rgba(145, 43, 94, 0.25), inset 0 1px 0 #fff;
		outline: none;
	}

	.dock-button.active {
		background: linear-gradient(145deg, #ffffff, #ffe0ef);
		transform: translateY(-0.3rem) scale(1.04);
	}

	.dock-button.active::after {
		content: '';
		position: absolute;
		bottom: -0.45rem;
		width: 0.48rem;
		height: 0.48rem;
		border-radius: 999px;
		background: #ff5f9f;
		box-shadow: 0 0 0 0.25rem rgba(255, 95, 159, 0.16);
	}

	.icon-wrap {
		display: grid;
		place-items: center;
		width: 2.7rem;
		height: 2.7rem;
	}

	svg {
		width: 100%;
		height: 100%;
		filter: drop-shadow(0 8px 10px rgba(108, 38, 66, 0.13));
	}

	.label {
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.02em;
	}

	@media (max-width: 520px) {
		.dock {
			gap: 0.55rem;
			padding: 0.55rem;
		}

		.label {
			display: none;
		}
	}
</style>
