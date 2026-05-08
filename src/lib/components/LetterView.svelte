<script>
	import PinGallery from './PinGallery.svelte';
	import SpotifyEmbed from './SpotifyEmbed.svelte';

	const letterParagraphs = [
		'My Alejandra, this little corner of the internet is for us. This is for your birthday :) Our memories and every tiny drawing here can tell our story.',
		'I made this so we can keep adding photos, stickers, silly sketches, and sweet notes. Every time we come back, the canvas should feel a little more like us.',
		'You are my favorite person and the reason this website exists. I hope every click here reminds you how much I love you.'
	];

	const pins = [
		{
			src: '/photos/p1.jpg',
			alt: 'Placeholder memory one',
			title: 'My Love',
			caption: 'You are my favorite person'
		},
		{
			src: '/photos/p2.jpg',
			alt: 'Placeholder memory two',
			title: 'Soft moment',
			caption: 'Awwwwwww you are soooo cute'
		},
		{
			src: '/photos/p3.jpg',
			alt: 'Placeholder memory three',
			title: 'Little adventure',
			caption: 'I loved this day'
		},
		{
			src: '/photos/p4.jpg',
			alt: 'Placeholder memory four',
			title: 'Favorite laugh',
			caption: 'hehehehehe'
		},
		{
			src: '/photos/p5.jpg',
			alt: 'Placeholder memory five',
			title: 'Forever pin',
			caption: 'My stupid girlll'
		}
	];
</script>

<section class="letter-shell" aria-label="Letter and memories for Alejandra">
	<div class="letter-hero">
		<div class="cake-card" aria-hidden="true">
			<div class="flame"></div>
			<div class="candle"></div>
			<div class="cake-top"></div>
			<div class="cake-middle"></div>
			<div class="cake-bottom"></div>
			<div class="plate"></div>
		</div>

		<div class="letter-card">
			<p class="kicker">for my girlfriend</p>
			<h2>A letter for Alejandra</h2>
			{#each letterParagraphs as paragraph}
				<p>{paragraph}</p>
			{/each}
			<p class="signature">Always yours,<br />Aniket</p>
		</div>
	</div>

	<div class="music-and-gallery">
		<SpotifyEmbed />

		<section class="pins-section" aria-labelledby="pins-heading">
			<div class="section-heading">
				<p class="kicker">five little pins</p>
				<h3 id="pins-heading">Pinterest memories</h3>
			</div>
			<PinGallery {pins} />
		</section>
	</div>
</section>

<style>
	.letter-shell {
		display: grid;
		gap: clamp(1rem, 2vw, 1.6rem);
		padding-bottom: 7rem;
	}

	.letter-hero {
		display: grid;
		grid-template-columns: minmax(14rem, 0.75fr) minmax(18rem, 1.25fr);
		gap: clamp(1rem, 3vw, 1.5rem);
		align-items: stretch;
	}

	.cake-card,
	.letter-card,
	.pins-section {
		border: 1px solid rgba(255, 255, 255, 0.75);
		border-radius: 2rem;
		background: rgba(255, 255, 255, 0.74);
		box-shadow: 0 24px 64px rgba(139, 42, 83, 0.15);
		backdrop-filter: blur(18px);
	}

	.cake-card {
		position: relative;
		display: grid;
		place-items: center;
		min-height: 28rem;
		overflow: hidden;
		background:
			radial-gradient(circle at 20% 20%, rgba(255, 221, 112, 0.28), transparent 12rem),
			radial-gradient(circle at 80% 18%, rgba(179, 136, 255, 0.22), transparent 13rem),
			linear-gradient(150deg, rgba(255, 255, 255, 0.84), rgba(255, 223, 237, 0.84));
	}

	.cake-card::before,
	.cake-card::after {
		content: '♡';
		position: absolute;
		color: rgba(255, 95, 159, 0.26);
		font-size: 5rem;
		font-weight: 900;
	}

	.cake-card::before {
		top: 2rem;
		left: 2rem;
		transform: rotate(-16deg);
	}

	.cake-card::after {
		right: 2rem;
		bottom: 2rem;
		transform: rotate(18deg);
	}

	.flame {
		position: absolute;
		top: 5rem;
		width: 2rem;
		height: 2.8rem;
		border-radius: 999px 999px 999px 0;
		background: linear-gradient(135deg, #fff1a8, #ff8a00 65%, #ff5f9f);
		box-shadow: 0 0 38px rgba(255, 158, 28, 0.55);
		transform: rotate(-38deg);
	}

	.candle {
		position: absolute;
		top: 7.5rem;
		width: 1.1rem;
		height: 4.2rem;
		border-radius: 999px;
		background: repeating-linear-gradient(45deg, #fff, #fff 0.38rem, #ff72a8 0.4rem, #ff72a8 0.72rem);
		box-shadow: 0 8px 15px rgba(108, 39, 66, 0.14);
	}

	.cake-top,
	.cake-middle,
	.cake-bottom,
	.plate {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		box-shadow: 0 18px 35px rgba(108, 39, 66, 0.14);
	}

	.cake-top {
		top: 11rem;
		width: 11rem;
		height: 4.2rem;
		border-radius: 1.2rem 1.2rem 0.8rem 0.8rem;
		background: linear-gradient(#fff9fc 0 42%, #ffd1e2 42% 100%);
	}

	.cake-middle {
		top: 14rem;
		width: 15rem;
		height: 5rem;
		border-radius: 1.2rem;
		background: linear-gradient(#fff 0 28%, #ffc3d8 28% 100%);
	}

	.cake-bottom {
		top: 18rem;
		width: 18rem;
		height: 5.2rem;
		border-radius: 1.35rem;
		background: linear-gradient(#fff9fc 0 28%, #ff8fbd 28% 100%);
	}

	.plate {
		top: 22.7rem;
		width: 21rem;
		height: 1.25rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.88);
	}

	.letter-card {
		padding: clamp(1.3rem, 4vw, 2.5rem);
	}

	.kicker {
		margin: 0 0 0.45rem;
		color: #ff5f9f;
		font-size: 0.78rem;
		font-weight: 950;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	h2,
	h3 {
		margin: 0;
		color: #64263d;
		font-size: clamp(2rem, 5vw, 4rem);
		line-height: 0.95;
		letter-spacing: -0.07em;
	}

	h3 {
		font-size: clamp(1.8rem, 4vw, 3rem);
	}

	.letter-card p:not(.kicker):not(.signature) {
		color: #6f3a50;
		font-size: clamp(1rem, 2vw, 1.15rem);
		line-height: 1.85;
	}

	.signature {
		margin: 1.5rem 0 0;
		color: #8f2e58;
		font-family: 'Brush Script MT', 'Segoe Script', cursive;
		font-size: clamp(1.6rem, 4vw, 2.2rem);
	}

	.music-and-gallery {
		display: grid;
		grid-template-columns: minmax(16rem, 0.72fr) minmax(20rem, 1.28fr);
		gap: clamp(1rem, 3vw, 1.5rem);
		align-items: start;
	}

	.pins-section {
		padding: clamp(1rem, 3vw, 1.4rem);
	}

	.section-heading {
		margin-bottom: 1rem;
	}

	@media (max-width: 900px) {
		.letter-hero,
		.music-and-gallery {
			grid-template-columns: 1fr;
		}

		.cake-card {
			min-height: 24rem;
		}

		.flame {
			top: 3.5rem;
		}

		.candle {
			top: 6rem;
		}

		.cake-top {
			top: 9.5rem;
		}

		.cake-middle {
			top: 12.5rem;
		}

		.cake-bottom {
			top: 16.5rem;
		}

		.plate {
			top: 21.2rem;
		}
	}

	@media (max-width: 480px) {
		.cake-card {
			min-height: 18rem;
		}

		.flame {
			top: 2.4rem;
			width: 1.4rem;
			height: 2rem;
		}

		.candle {
			top: 4.2rem;
			width: 0.8rem;
			height: 3rem;
		}

		.cake-top {
			top: 6.8rem;
			width: 8rem;
			height: 3rem;
		}

		.cake-middle {
			top: 9.4rem;
			width: 11rem;
			height: 3.8rem;
		}

		.cake-bottom {
			top: 12.7rem;
			width: 13.5rem;
			height: 4rem;
		}

		.plate {
			top: 16.3rem;
			width: 16rem;
		}
	}
</style>
