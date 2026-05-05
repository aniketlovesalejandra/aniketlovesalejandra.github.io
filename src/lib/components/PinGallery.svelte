<script>
	export let pins = [];
</script>

<div class="pin-gallery" aria-label="Pinned photo memories">
	{#each pins as pin, index}
		<article class="pin" class:tall={index === 1 || index === 4} class:wide={index === 2}>
			<img src={pin.src} alt={pin.alt} loading="lazy" />
			<div>
				<strong>{pin.title}</strong>
				<span>{pin.caption}</span>
			</div>
		</article>
	{/each}
</div>

<style>
	.pin-gallery {
		columns: 3 14rem;
		column-gap: 1rem;
	}

	.pin {
		display: inline-block;
		width: 100%;
		margin: 0 0 1rem;
		break-inside: avoid;
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.75);
		border-radius: 1.35rem;
		background: rgba(255, 255, 255, 0.85);
		box-shadow: 0 18px 44px rgba(116, 37, 72, 0.14);
		transform: rotate(var(--tilt, -1deg));
		transition: transform 180ms ease, box-shadow 180ms ease;
	}

	.pin:nth-child(2n) {
		--tilt: 1.2deg;
	}

	.pin:nth-child(3n) {
		--tilt: -0.4deg;
	}

	.pin:hover {
		transform: translateY(-0.3rem) rotate(0deg);
		box-shadow: 0 24px 56px rgba(116, 37, 72, 0.2);
	}

	.pin img {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 5;
		object-fit: cover;
		background: #ffeaf3;
	}

	.pin.tall img {
		aspect-ratio: 3 / 5;
	}

	.pin.wide img {
		aspect-ratio: 5 / 4;
	}

	.pin div {
		display: grid;
		gap: 0.2rem;
		padding: 0.85rem;
	}

	.pin strong {
		color: #6e2c47;
		font-size: 1rem;
	}

	.pin span {
		color: #94566e;
		font-size: 0.88rem;
		line-height: 1.45;
	}

	@media (max-width: 720px) {
		.pin-gallery {
			columns: 2 10rem;
		}
	}

	@media (max-width: 460px) {
		.pin-gallery {
			columns: 1;
		}
	}
</style>
