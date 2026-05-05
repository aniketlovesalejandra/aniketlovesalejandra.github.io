<script>
	import { onMount, tick } from 'svelte';
	import {
		fileToDataUrl,
		getSession,
		hasSupabaseConfig,
		loadCanvasState,
		onAuthChange,
		saveCanvasState,
		signInWithEmail,
		signOut,
		uploadCanvasImage
	} from '$lib/services/supabaseClient';

	const stickers = [
		{ id: 'heart', label: 'Pink heart sticker', src: '/stickers/heart.svg' },
		{ id: 'sparkle', label: 'Sparkle sticker', src: '/stickers/sparkle.svg' },
		{ id: 'flower', label: 'Flower sticker', src: '/stickers/flower.svg' },
		{ id: 'cake', label: 'Cake sticker', src: '/stickers/cake.svg' }
	];

	let boardEl;
	let drawingCanvas;
	let fileInput;
	let resizeObserver;
	let saveTimer;

	let items = [];
	let strokes = [];
	let currentStroke = null;
	let currentTool = 'pencil';
	let isDrawing = false;
	let isUploading = false;
	let isLoaded = false;
	let currentDrag = null;
	let authSession = null;
	let email = '';
	let authMessage = '';
	let statusMessage = 'Loading your forever canvas…';
	let statusTone = 'neutral';

	const brush = {
		color: '#9747ff',
		width: 4
	};

	$: userEmail = authSession?.user?.email ?? '';
	$: canSaveForever = hasSupabaseConfig && Boolean(authSession?.user);
	$: saveMode = hasSupabaseConfig
		? canSaveForever
			? 'saving forever to Supabase'
			: 'local draft until you sign in'
		: 'local demo save';

	onMount(async () => {
		const unsubscribe = onAuthChange((session) => {
			authSession = session;
		});

		try {
			authSession = await getSession();
		} catch (error) {
			console.warn('Unable to read Supabase session', error);
		}

		await loadInitialState();
		await tick();
		resizeDrawingCanvas();

		if (typeof ResizeObserver !== 'undefined' && boardEl) {
			resizeObserver = new ResizeObserver(resizeDrawingCanvas);
			resizeObserver.observe(boardEl);
		}

		return () => {
			unsubscribe();
			resizeObserver?.disconnect();
			window.clearTimeout(saveTimer);
		};
	});

	function createId(prefix) {
		if (typeof crypto !== 'undefined' && crypto.randomUUID) {
			return `${prefix}-${crypto.randomUUID()}`;
		}

		return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	function clamp(value, min, max) {
		return Math.min(max, Math.max(min, value));
	}

	async function loadInitialState() {
		try {
			const state = await loadCanvasState();
			items = state.items ?? [];
			strokes = state.strokes ?? [];
			isLoaded = true;
			statusTone = 'success';
			statusMessage = state.updatedAt
				? `Loaded the canvas saved ${formatTimestamp(state.updatedAt)}.`
				: 'Blank canvas ready. Drop a photo, add a sticker, or draw something sweet.';
		} catch (error) {
			console.error('Canvas load failed', error);
			isLoaded = true;
			statusTone = 'error';
			statusMessage = 'Could not load the permanent canvas. A local draft canvas is ready.';
		}
	}

	function formatTimestamp(value) {
		try {
			return new Intl.DateTimeFormat('en-US', {
				month: 'short',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
			}).format(new Date(value));
		} catch {
			return 'recently';
		}
	}

	function resizeDrawingCanvas() {
		if (!boardEl || !drawingCanvas) return;

		const rect = boardEl.getBoundingClientRect();
		const dpr = window.devicePixelRatio || 1;
		drawingCanvas.width = Math.max(1, Math.round(rect.width * dpr));
		drawingCanvas.height = Math.max(1, Math.round(rect.height * dpr));
		drawingCanvas.style.width = `${rect.width}px`;
		drawingCanvas.style.height = `${rect.height}px`;

		const context = drawingCanvas.getContext('2d');
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		redrawAll();
	}

	function redrawAll(extraStroke = currentStroke) {
		if (!boardEl || !drawingCanvas) return;

		const rect = boardEl.getBoundingClientRect();
		const context = drawingCanvas.getContext('2d');
		context.clearRect(0, 0, rect.width, rect.height);

		for (const stroke of strokes) {
			drawStroke(context, stroke, rect);
		}

		if (extraStroke) {
			drawStroke(context, extraStroke, rect);
		}
	}

	function drawStroke(context, stroke, rect) {
		const points = stroke.points ?? [];
		if (!points.length) return;

		context.save();
		context.lineCap = 'round';
		context.lineJoin = 'round';
		context.strokeStyle = stroke.color ?? brush.color;
		context.fillStyle = stroke.color ?? brush.color;
		context.lineWidth = stroke.width ?? brush.width;

		const first = points[0];
		context.beginPath();
		context.moveTo(first.x * rect.width, first.y * rect.height);

		if (points.length === 1) {
			context.arc(first.x * rect.width, first.y * rect.height, (stroke.width ?? brush.width) / 2, 0, Math.PI * 2);
			context.fill();
			context.restore();
			return;
		}

		for (const point of points.slice(1)) {
			context.lineTo(point.x * rect.width, point.y * rect.height);
		}

		context.stroke();
		context.restore();
	}

	function getPointerPoint(event) {
		const rect = boardEl.getBoundingClientRect();
		return {
			x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
			y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
		};
	}

	function startDrawing(event) {
		if (currentTool !== 'pencil' || !isLoaded) return;

		event.preventDefault();
		drawingCanvas.setPointerCapture?.(event.pointerId);
		isDrawing = true;
		currentStroke = {
			id: createId('stroke'),
			color: brush.color,
			width: brush.width,
			points: [getPointerPoint(event)]
		};
		redrawAll(currentStroke);
	}

	function continueDrawing(event) {
		if (!isDrawing || !currentStroke) return;

		event.preventDefault();
		currentStroke = {
			...currentStroke,
			points: [...currentStroke.points, getPointerPoint(event)]
		};
		redrawAll(currentStroke);
	}

	function endDrawing(event) {
		if (!isDrawing || !currentStroke) return;

		event.preventDefault();
		drawingCanvas.releasePointerCapture?.(event.pointerId);
		strokes = [...strokes, currentStroke];
		currentStroke = null;
		isDrawing = false;
		redrawAll(null);
		scheduleSave();
	}

	function itemStyle(item) {
		return [
			`left: ${item.x}%`,
			`top: ${item.y}%`,
			`width: ${item.width}%`,
			`transform: rotate(${item.rotation ?? 0}deg)`,
			`z-index: ${item.z ?? 1}`
		].join('; ');
	}

	function nextZIndex() {
		return Math.max(1, ...items.map((item) => item.z ?? 1)) + 1;
	}

	function startItemDrag(event, item) {
		if (currentTool !== 'move') return;

		event.preventDefault();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		const rect = boardEl.getBoundingClientRect();
		const itemLeft = (item.x / 100) * rect.width;
		const itemTop = (item.y / 100) * rect.height;

		currentDrag = {
			id: item.id,
			pointerId: event.pointerId,
			offsetX: event.clientX - rect.left - itemLeft,
			offsetY: event.clientY - rect.top - itemTop
		};

		const z = nextZIndex();
		items = items.map((canvasItem) => (canvasItem.id === item.id ? { ...canvasItem, z } : canvasItem));
	}

	function dragItem(event) {
		if (!currentDrag || event.pointerId !== currentDrag.pointerId) return;

		event.preventDefault();
		const rect = boardEl.getBoundingClientRect();
		const nextX = ((event.clientX - rect.left - currentDrag.offsetX) / rect.width) * 100;
		const nextY = ((event.clientY - rect.top - currentDrag.offsetY) / rect.height) * 100;

		items = items.map((item) =>
			item.id === currentDrag.id
				? {
						...item,
						x: clamp(nextX, 0, 92),
						y: clamp(nextY, 0, 90)
					}
				: item
		);
	}

	function endItemDrag(event) {
		if (!currentDrag || event.pointerId !== currentDrag.pointerId) return;

		event.currentTarget.releasePointerCapture?.(event.pointerId);
		currentDrag = null;
		scheduleSave();
	}

	function handleDragOver(event) {
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
	}

	async function handleDrop(event) {
		event.preventDefault();
		const rect = boardEl.getBoundingClientRect();
		const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 4, 82);
		const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 4, 78);
		await addFiles(Array.from(event.dataTransfer.files), { x, y });
	}

	async function handleFileInput(event) {
		await addFiles(Array.from(event.currentTarget.files ?? []), { x: 38, y: 32 });
		event.currentTarget.value = '';
	}

	async function addFiles(files, placement) {
		const imageFiles = files.filter((file) => file.type.startsWith('image/'));
		if (!imageFiles.length) {
			statusTone = 'error';
			statusMessage = 'Please choose an image file.';
			return;
		}

		isUploading = true;
		statusTone = 'neutral';
		statusMessage = canSaveForever ? 'Uploading image forever…' : 'Adding image as a local draft…';

		const addedItems = [];
		for (const [index, file] of imageFiles.entries()) {
			let src;

			try {
				src = await uploadCanvasImage(file, { remote: canSaveForever });
			} catch (error) {
				console.error('Image upload failed, using local draft', error);
				src = await fileToDataUrl(file);
				statusTone = 'error';
				statusMessage = 'Upload failed, so the image was added as a local draft.';
			}

			addedItems.push({
				id: createId('image'),
				type: 'image',
				src,
				alt: file.name || 'Dropped canvas image',
				x: clamp(placement.x + index * 3, 4, 82),
				y: clamp(placement.y + index * 3, 4, 78),
				width: 24,
				rotation: index % 2 === 0 ? -2 : 2,
				z: nextZIndex() + index
			});
		}

		items = [...items, ...addedItems];
		isUploading = false;
		currentTool = 'move';
		scheduleSave();
	}

	function addSticker(sticker) {
		items = [
			...items,
			{
				id: createId('sticker'),
				type: 'sticker',
				src: sticker.src,
				alt: sticker.label,
				x: 42 + Math.random() * 8,
				y: 34 + Math.random() * 10,
				width: 12,
				rotation: -8 + Math.random() * 16,
				z: nextZIndex()
			}
		];
		currentTool = 'move';
		scheduleSave();
	}

	function undoLast() {
		if (strokes.length) {
			strokes = strokes.slice(0, -1);
			redrawAll(null);
			scheduleSave();
			return;
		}

		if (items.length) {
			const topItem = items.reduce((top, item) => ((item.z ?? 0) > (top.z ?? 0) ? item : top), items[0]);
			items = items.filter((item) => item.id !== topItem.id);
			scheduleSave();
		}
	}

	function clearCanvas() {
		if (!window.confirm('Clear every drawing, photo, and sticker from this canvas?')) return;

		items = [];
		strokes = [];
		redrawAll(null);
		scheduleSave();
	}

	function scheduleSave() {
		if (!isLoaded) return;

		window.clearTimeout(saveTimer);
		statusTone = 'neutral';
		statusMessage = canSaveForever ? 'Saving this to the forever canvas…' : 'Saving a local draft…';

		saveTimer = window.setTimeout(persistCanvasState, 650);
	}

	async function persistCanvasState() {
		try {
			const result = await saveCanvasState(
				{
					version: 1,
					items,
					strokes
				},
				{ remote: canSaveForever }
			);

			statusTone = 'success';
			statusMessage =
				result.target === 'supabase'
					? 'Saved forever 💌'
					: hasSupabaseConfig
						? 'Local draft saved. Sign in to make it permanent.'
						: 'Saved on this browser. Add Supabase keys to make it permanent everywhere.';
		} catch (error) {
			console.error('Canvas save failed', error);
			await saveCanvasState(
				{
					version: 1,
					items,
					strokes
				},
				{ remote: false }
			);
			statusTone = 'error';
			statusMessage = 'Permanent save failed. A safe local draft was saved instead.';
		}
	}

	async function requestMagicLink() {
		if (!email.trim()) {
			authMessage = 'Enter the email that is allowed to save this canvas.';
			return;
		}

		authMessage = 'Sending magic link…';

		try {
			const { error } = await signInWithEmail(email.trim());
			if (error) throw error;
			authMessage = 'Magic link sent. Open it here to unlock forever saves.';
		} catch (error) {
			console.error('Magic link failed', error);
			authMessage = error.message ?? 'Could not send the magic link.';
		}
	}

	async function handleSignOut() {
		try {
			await signOut();
			authMessage = 'Signed out.';
		} catch (error) {
			authMessage = error.message ?? 'Could not sign out.';
		}
	}
</script>

<section class="canvas-shell" aria-label="Forever drawing canvas">
	<div class="toolbar-card">
		<div class="toolbar-row">
			<div class="tool-group" aria-label="Canvas tools">
				<button type="button" class:active={currentTool === 'pencil'} on:click={() => (currentTool = 'pencil')}>
					✏️ Pencil
				</button>
				<button type="button" class:active={currentTool === 'move'} on:click={() => (currentTool = 'move')}>
					🖐️ Move
				</button>
			</div>

			<div class="tool-group">
				<button type="button" on:click={() => fileInput.click()} disabled={isUploading}>
					{isUploading ? 'Adding…' : 'Add image'}
				</button>
				<input bind:this={fileInput} class="hidden-input" type="file" accept="image/*" multiple on:change={handleFileInput} />
				<button type="button" on:click={undoLast} disabled={!items.length && !strokes.length}>Undo</button>
				<button type="button" class="danger" on:click={clearCanvas} disabled={!items.length && !strokes.length}>Clear</button>
			</div>
		</div>

		<div class="sticker-row" aria-label="Sticker palette">
			<span>Stickers</span>
			{#each stickers as sticker}
				<button type="button" class="sticker-button" on:click={() => addSticker(sticker)} aria-label={`Add ${sticker.label}`}>
					<img src={sticker.src} alt="" />
				</button>
			{/each}
		</div>
	</div>

	<div class="auth-card">
		{#if hasSupabaseConfig}
			{#if userEmail}
				<div>
					<strong>Forever saves unlocked</strong>
					<span>Signed in as {userEmail}</span>
				</div>
				<button type="button" on:click={handleSignOut}>Sign out</button>
			{:else}
				<div>
					<strong>Sign in to save forever</strong>
					<span>Your edits are drafts until an allowed email signs in.</span>
				</div>
				<label>
					<span class="sr-only">Allowed email</span>
					<input bind:value={email} type="email" placeholder="you@example.com" />
				</label>
				<button type="button" on:click={requestMagicLink}>Send link</button>
			{/if}
		{:else}
			<div>
				<strong>Local demo mode</strong>
				<span>Add Supabase keys to make every upload permanent for both of you.</span>
			</div>
		{/if}
	</div>

	{#if authMessage}
		<p class="auth-message">{authMessage}</p>
	{/if}

	<div class="board-frame">
		<div
			bind:this={boardEl}
			class="canvas-board"
			class:pencil-active={currentTool === 'pencil'}
			on:dragover={handleDragOver}
			on:drop={handleDrop}
		>
			<canvas
				bind:this={drawingCanvas}
				class="drawing-layer"
				class:drawing-enabled={currentTool === 'pencil'}
				on:pointerdown={startDrawing}
				on:pointermove={continueDrawing}
				on:pointerup={endDrawing}
				on:pointercancel={endDrawing}
				aria-label="Pencil drawing layer"
			/>

			{#each items as item (item.id)}
				<button
					type="button"
					class="canvas-item"
					class:movable={currentTool === 'move'}
					style={itemStyle(item)}
					on:pointerdown={(event) => startItemDrag(event, item)}
					on:pointermove={dragItem}
					on:pointerup={endItemDrag}
					on:pointercancel={endItemDrag}
					aria-label={`Move ${item.alt ?? item.type}`}
				>
					<img src={item.src} alt={item.alt ?? ''} draggable="false" />
				</button>
			{/each}

			{#if !items.length && !strokes.length}
				<div class="empty-state" aria-hidden="true">
					<div>Drop a picture here</div>
					<span>or draw a tiny love note with the pencil</span>
				</div>
			{/if}
		</div>
	</div>

	<p class:success={statusTone === 'success'} class:error={statusTone === 'error'} class="status-line">
		<span>{statusMessage}</span>
		<small>{saveMode}</small>
	</p>
</section>

<style>
	.canvas-shell {
		display: grid;
		gap: 1rem;
		min-height: min(72vh, 54rem);
	}

	.toolbar-card,
	.auth-card {
		border: 1px solid rgba(255, 255, 255, 0.72);
		border-radius: 1.4rem;
		background: rgba(255, 255, 255, 0.72);
		box-shadow: 0 18px 45px rgba(153, 48, 98, 0.1);
		backdrop-filter: blur(18px);
	}

	.toolbar-card {
		display: grid;
		gap: 0.75rem;
		padding: 0.8rem;
	}

	.toolbar-row,
	.sticker-row,
	.auth-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.tool-group {
		display: flex;
		gap: 0.45rem;
		align-items: center;
		flex-wrap: wrap;
	}

	button {
		border: 0;
		border-radius: 999px;
		padding: 0.65rem 0.9rem;
		font: inherit;
		font-weight: 800;
		color: #6b2842;
		background: #fff;
		box-shadow: 0 10px 24px rgba(160, 50, 100, 0.13);
		cursor: pointer;
		transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
	}

	button:hover:not(:disabled),
	button:focus-visible:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 14px 30px rgba(160, 50, 100, 0.18);
		outline: none;
	}

	button.active {
		color: #fff;
		background: linear-gradient(135deg, #ff5f9f, #9d6bff);
	}

	button.danger {
		color: #9b244b;
		background: #fff0f5;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hidden-input {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.sticker-row {
		justify-content: flex-start;
	}

	.sticker-row > span {
		font-weight: 900;
		color: #7a304c;
	}

	.sticker-button {
		display: grid;
		place-items: center;
		width: 3.2rem;
		height: 3.2rem;
		padding: 0.4rem;
		background: linear-gradient(145deg, #fff, #fff0f7);
	}

	.sticker-button img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.auth-card {
		padding: 0.85rem 1rem;
		color: #6b2842;
	}

	.auth-card div {
		display: grid;
		gap: 0.15rem;
	}

	.auth-card strong {
		font-size: 0.95rem;
	}

	.auth-card span,
	.auth-message,
	.status-line small {
		color: #8b5268;
		font-size: 0.86rem;
	}

	.auth-card input {
		min-width: min(16rem, 62vw);
		border: 1px solid rgba(255, 116, 166, 0.28);
		border-radius: 999px;
		padding: 0.72rem 0.9rem;
		font: inherit;
		color: #5a2035;
		background: rgba(255, 255, 255, 0.86);
	}

	.auth-message {
		margin: -0.35rem 0 0;
	}

	.board-frame {
		min-height: clamp(28rem, 64vh, 48rem);
		padding: clamp(0.35rem, 1vw, 0.8rem);
		border: 1px solid rgba(255, 255, 255, 0.7);
		border-radius: 2rem;
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.72), rgba(255, 238, 247, 0.5));
		box-shadow: 0 28px 75px rgba(124, 40, 82, 0.14);
	}

	.canvas-board {
		position: relative;
		isolation: isolate;
		overflow: hidden;
		min-height: inherit;
		border: 1px dashed rgba(255, 115, 166, 0.32);
		border-radius: 1.55rem;
		background:
			radial-gradient(circle at 10% 12%, rgba(255, 199, 218, 0.35), transparent 24rem),
			radial-gradient(circle at 88% 18%, rgba(179, 136, 255, 0.18), transparent 20rem),
			#fffefe;
	}

	.canvas-board::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 0;
		background-image: radial-gradient(rgba(255, 150, 189, 0.12) 1px, transparent 1px);
		background-size: 26px 26px;
		pointer-events: none;
	}

	.drawing-layer {
		position: absolute;
		inset: 0;
		z-index: 2;
		touch-action: none;
		pointer-events: none;
	}

	.drawing-layer.drawing-enabled {
		cursor: crosshair;
		pointer-events: auto;
	}

	.canvas-item {
		position: absolute;
		z-index: 3;
		display: block;
		min-width: 4rem;
		padding: 0;
		border-radius: 1rem;
		background: transparent;
		box-shadow: none;
		pointer-events: none;
		touch-action: none;
		transform-origin: center;
	}

	.canvas-item.movable {
		cursor: grab;
		pointer-events: auto;
	}

	.canvas-item.movable:active {
		cursor: grabbing;
	}

	.canvas-item img {
		display: block;
		width: 100%;
		height: auto;
		border-radius: 1rem;
		box-shadow: 0 18px 42px rgba(93, 32, 62, 0.2);
		user-select: none;
		-webkit-user-drag: none;
	}

	.canvas-item:hover img,
	.canvas-item:focus-visible img {
		outline: 3px solid rgba(255, 95, 159, 0.35);
		outline-offset: 4px;
	}

	.empty-state {
		position: absolute;
		inset: 0;
		z-index: 1;
		display: grid;
		place-content: center;
		gap: 0.35rem;
		text-align: center;
		color: rgba(108, 39, 66, 0.42);
		pointer-events: none;
	}

	.empty-state div {
		font-size: clamp(2rem, 8vw, 5.4rem);
		font-weight: 900;
		letter-spacing: -0.08em;
	}

	.empty-state span {
		font-weight: 800;
		letter-spacing: 0.02em;
	}

	.status-line {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		margin: 0;
		padding: 0 0.25rem;
		color: #79435a;
		font-weight: 800;
	}

	.status-line.success span {
		color: #2f7a55;
	}

	.status-line.error span {
		color: #a22b50;
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
		.toolbar-row,
		.auth-card,
		.status-line {
			align-items: stretch;
			flex-direction: column;
		}

		.tool-group {
			width: 100%;
		}

		.tool-group button,
		.auth-card button {
			flex: 1;
		}

		.board-frame {
			min-height: 62vh;
		}

		.canvas-item {
			min-width: 3rem;
		}
	}
</style>
