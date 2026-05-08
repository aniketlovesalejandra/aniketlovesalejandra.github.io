<script>
	import { env } from '$env/dynamic/public';

	export let title = 'A Spotify song for us';

	const fallbackEmbedUrl = 'https://open.spotify.com/embed/track/16gJmoOqRt2lKmlXtDpWgH?utm_source=generator&theme=0';
	$: embedUrl = env.PUBLIC_SPOTIFY_EMBED_URL || fallbackEmbedUrl;
</script>

<div class="spotify-card">
	<div class="spotify-copy">
		<span>our song</span>
		<strong>Press play and read slowly</strong>
	</div>
	<iframe
		title={title}
		src={embedUrl}
		width="100%"
		height="352"
		frameborder="0"
		allowfullscreen
		allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
		loading="lazy"
	/>
</div>

<style>
	.spotify-card {
		display: grid;
		gap: 1rem;
		padding: 1rem;
		border: 1px solid rgba(255, 255, 255, 0.7);
		border-radius: 1.5rem;
		background: linear-gradient(135deg, rgba(27, 21, 26, 0.92), rgba(91, 34, 62, 0.9));
		box-shadow: 0 22px 48px rgba(68, 24, 45, 0.2);
		color: #fff;
	}

	.spotify-copy {
		display: grid;
		gap: 0.1rem;
	}

	.spotify-copy span {
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #ffc7da;
	}

	.spotify-copy strong {
		font-size: clamp(1.1rem, 2.6vw, 1.45rem);
	}

	iframe {
		display: block;
		border: 0;
		border-radius: 1rem;
		background: #121212;
	}

	@media (max-width: 520px) {
		iframe {
			height: 152px;
		}
	}
</style>
