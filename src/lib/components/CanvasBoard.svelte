<script>
	import { onMount, tick } from 'svelte';
	import {
		fileToDataUrl,
		getSession,
		hasSupabaseConfig,
		loadCanvasState,
		onAuthChange,
		saveCanvasState,
		uploadCanvasImage
	} from '$lib/services/supabaseClient';

	let boardEl;
	let drawingCanvas;
	let resizeObserver;
	let saveTimer;

	let items = [];
	let strokes = [];
	let currentStroke = null;
	let currentTool = 'pencil';
	let currentResize = null;
	let currentDrag = null;
	let currentRotate = null;
	let selectedItemId = null;
	let isDrawing = false;
	let isUploading = false;
	let isLoaded = false;
	let authSession = null;
	let statusMessage = 'Loading your forever canvas…';

	const brush = {
		color: '#9747ff',
		width: 4
	};

	const eraser = {
		width: 28
	};

	$: canSaveForever = hasSupabaseConfig && Boolean(authSession?.user);

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

	function normalizeAngle(value) {
		return ((((value + 180) % 360) + 360) % 360) - 180;
	}

	async function loadInitialState() {
		try {
			const state = await loadCanvasState();
			items = state.items ?? [];
			strokes = state.strokes ?? [];
			isLoaded = true;
			statusMessage = state.updatedAt
				? `Loaded the canvas saved ${formatTimestamp(state.updatedAt)}.`
				: 'Blank canvas ready. Drop a photo anywhere, or write right on the page.';
		} catch (error) {
			console.error('Canvas load failed', error);
			isLoaded = true;
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

		const isEraser = stroke.tool === 'eraser';
		const strokeWidth = stroke.width ?? (isEraser ? eraser.width : brush.width);
		const strokeColor = isEraser ? 'rgba(0, 0, 0, 1)' : (stroke.color ?? brush.color);

		context.save();
		context.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
		context.lineCap = 'round';
		context.lineJoin = 'round';
		context.strokeStyle = strokeColor;
		context.fillStyle = strokeColor;
		context.lineWidth = strokeWidth;

		const first = points[0];
		context.beginPath();
		context.moveTo(first.x * rect.width, first.y * rect.height);

		if (points.length === 1) {
			context.arc(first.x * rect.width, first.y * rect.height, strokeWidth / 2, 0, Math.PI * 2);
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

	function setTool(tool) {
		currentTool = tool;
	}

	function startDrawing(event) {
		if (!isLoaded) return;

		event.preventDefault();
		selectedItemId = null;
		drawingCanvas.setPointerCapture?.(event.pointerId);
		const tool = currentTool === 'eraser' ? 'eraser' : 'pencil';
		const isEraser = tool === 'eraser';
		isDrawing = true;
		currentStroke = {
			id: createId('stroke'),
			tool,
			color: brush.color,
			width: isEraser ? eraser.width : brush.width,
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

	function itemStyle(item, zOffset = 0) {
		return [
			`left: ${item.x}%`,
			`top: ${item.y}%`,
			`width: ${item.width}%`,
			`transform: rotate(${item.rotation ?? 0}deg)`,
			`z-index: ${(item.z ?? 1) + zOffset}`
		].join('; ');
	}

	function nextZIndex() {
		return Math.max(1, ...items.map((item) => item.z ?? 1)) + 1;
	}

	function selectImage(event, item) {
		event.preventDefault();
		event.stopPropagation();
		selectedItemId = item.id;
		statusMessage = 'Image selected. Drag it, rotate it, resize it, or remove it.';
	}

	function startImageDrag(event, item) {
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		selectedItemId = item.id;

		const rect = boardEl.getBoundingClientRect();
		const z = nextZIndex();
		currentDrag = {
			id: item.id,
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startX: item.x,
			startY: item.y,
			width: item.width,
			boardWidth: rect.width,
			boardHeight: rect.height,
			moved: false
		};

		items = items.map((canvasItem) => (canvasItem.id === item.id ? { ...canvasItem, z } : canvasItem));
	}

	function dragImage(event) {
		if (!currentDrag || event.pointerId !== currentDrag.pointerId) return;

		event.preventDefault();
		event.stopPropagation();
		const deltaX = ((event.clientX - currentDrag.startClientX) / currentDrag.boardWidth) * 100;
		const deltaY = ((event.clientY - currentDrag.startClientY) / currentDrag.boardHeight) * 100;
		const moved = currentDrag.moved || Math.abs(deltaX) > 0.25 || Math.abs(deltaY) > 0.25;
		const maxX = Math.max(0, 100 - currentDrag.width);
		currentDrag = { ...currentDrag, moved };

		items = items.map((item) =>
			item.id === currentDrag.id
				? {
						...item,
						x: clamp(currentDrag.startX + deltaX, 0, maxX),
						y: clamp(currentDrag.startY + deltaY, 0, 90)
					}
				: item
		);
	}

	function endImageDrag(event) {
		if (!currentDrag || event.pointerId !== currentDrag.pointerId) return;

		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		const moved = currentDrag.moved;
		currentDrag = null;

		if (moved) {
			statusMessage = 'Image moved.';
			scheduleSave();
		}
	}

	function handleImageKeydown(event, item) {
		const step = event.shiftKey ? 5 : 2;
		let nextX = item.x;
		let nextY = item.y;

		if (event.key === 'ArrowRight') {
			nextX = clamp(item.x + step, 0, Math.max(0, 100 - item.width));
		} else if (event.key === 'ArrowLeft') {
			nextX = clamp(item.x - step, 0, Math.max(0, 100 - item.width));
		} else if (event.key === 'ArrowDown') {
			nextY = clamp(item.y + step, 0, 90);
		} else if (event.key === 'ArrowUp') {
			nextY = clamp(item.y - step, 0, 90);
		} else {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		selectedItemId = item.id;
		items = items.map((canvasItem) => (canvasItem.id === item.id ? { ...canvasItem, x: nextX, y: nextY } : canvasItem));
		statusMessage = 'Image moved.';
		scheduleSave();
	}

	function removeImage(itemId) {
		items = items.filter((item) => item.id !== itemId);
		if (selectedItemId === itemId) {
			selectedItemId = null;
		}
		statusMessage = 'Image removed.';
		scheduleSave();
	}

	function startImageResize(event, item) {
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		selectedItemId = item.id;

		const rect = boardEl.getBoundingClientRect();
		currentResize = {
			id: item.id,
			pointerId: event.pointerId,
			startX: event.clientX,
			startWidth: item.width,
			boardWidth: rect.width
		};
	}

	function resizeImage(event) {
		if (!currentResize || event.pointerId !== currentResize.pointerId) return;

		event.preventDefault();
		event.stopPropagation();
		const deltaPercent = ((event.clientX - currentResize.startX) / currentResize.boardWidth) * 100;
		const width = clamp(currentResize.startWidth + deltaPercent, 8, 72);
		items = items.map((item) => (item.id === currentResize.id ? { ...item, width } : item));
	}

	function endImageResize(event) {
		if (!currentResize || event.pointerId !== currentResize.pointerId) return;

		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		currentResize = null;
		statusMessage = 'Image resized.';
		scheduleSave();
	}

	function handleResizeKeydown(event, item) {
		const step = event.shiftKey ? 5 : 2;
		let width = item.width;

		if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
			width = clamp(item.width + step, 8, 72);
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
			width = clamp(item.width - step, 8, 72);
		} else {
			return;
		}

		event.preventDefault();
		items = items.map((canvasItem) => (canvasItem.id === item.id ? { ...canvasItem, width } : canvasItem));
		statusMessage = 'Image resized.';
		scheduleSave();
	}

	function pointerAngle(event, center) {
		return (Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180) / Math.PI;
	}

	function startImageRotate(event, item) {
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		selectedItemId = item.id;

		const imageRect = event.currentTarget.parentElement?.querySelector('.control-measure')?.getBoundingClientRect();
		if (!imageRect) return;

		const center = {
			x: imageRect.left + imageRect.width / 2,
			y: imageRect.top + imageRect.height / 2
		};

		currentRotate = {
			id: item.id,
			pointerId: event.pointerId,
			center,
			startAngle: pointerAngle(event, center),
			startRotation: item.rotation ?? 0
		};
	}

	function rotateImage(event) {
		if (!currentRotate || event.pointerId !== currentRotate.pointerId) return;

		event.preventDefault();
		event.stopPropagation();
		const nextAngle = pointerAngle(event, currentRotate.center);
		const delta = normalizeAngle(nextAngle - currentRotate.startAngle);
		const rotation = Math.round(normalizeAngle(currentRotate.startRotation + delta) * 10) / 10;
		items = items.map((item) => (item.id === currentRotate.id ? { ...item, rotation } : item));
	}

	function endImageRotate(event) {
		if (!currentRotate || event.pointerId !== currentRotate.pointerId) return;

		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		currentRotate = null;
		statusMessage = 'Image rotated.';
		scheduleSave();
	}

	function handleRotateKeydown(event, item) {
		const step = event.shiftKey ? 15 : 5;
		let rotation = item.rotation ?? 0;

		if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
			rotation = normalizeAngle(rotation + step);
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
			rotation = normalizeAngle(rotation - step);
		} else {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		selectedItemId = item.id;
		items = items.map((canvasItem) => (canvasItem.id === item.id ? { ...canvasItem, rotation } : canvasItem));
		statusMessage = 'Image rotated.';
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

	async function addFiles(files, placement) {
		const imageFiles = files.filter((file) => file.type.startsWith('image/'));
		if (!imageFiles.length) {
			statusMessage = 'Drop an image file onto the canvas.';
			return;
		}

		isUploading = true;
		statusMessage = canSaveForever ? 'Uploading image forever…' : 'Adding image as a local draft…';

		try {
			const addedItems = [];
			for (const [index, file] of imageFiles.entries()) {
				let src;

				try {
					src = await uploadCanvasImage(file, { remote: canSaveForever });
				} catch (error) {
					console.error('Image upload failed, using local draft', error);
					src = await fileToDataUrl(file);
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
			selectedItemId = null;
			scheduleSave();
		} finally {
			isUploading = false;
		}
	}

	function scheduleSave() {
		if (!isLoaded) return;

		window.clearTimeout(saveTimer);
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
			statusMessage = 'Permanent save failed. A safe local draft was saved instead.';
		}
	}
</script>

<section class="canvas-shell" aria-label="Forever drawing canvas">
	<div class="board-frame">
		<div
			bind:this={boardEl}
			class="canvas-board"
			role="region"
			aria-label="Full-page drawing and drop canvas"
			on:dragover={handleDragOver}
			on:drop={handleDrop}
		>
			<canvas
				bind:this={drawingCanvas}
				class="drawing-layer"
				class:eraser-enabled={currentTool === 'eraser'}
				on:pointerdown={startDrawing}
				on:pointermove={continueDrawing}
				on:pointerup={endDrawing}
				on:pointercancel={endDrawing}
				aria-label="Always-on drawing layer"
			/>

			{#each items as item (item.id)}
				<div class="canvas-item" style={itemStyle(item)}>
					<img src={item.src} alt={item.alt ?? ''} draggable="false" />
				</div>
			{/each}

			<div class="image-controls-layer" aria-label="Image controls">
				{#each items as item (item.id)}
					<div class="image-controls" class:selected={selectedItemId === item.id} style={itemStyle(item, 20)}>
						<img class="control-measure" src={item.src} alt="" draggable="false" />
						<button
							type="button"
							class="select-image"
							on:pointerdown={(event) => startImageDrag(event, item)}
							on:pointermove={dragImage}
							on:pointerup={endImageDrag}
							on:pointercancel={endImageDrag}
							on:click={(event) => selectImage(event, item)}
							on:keydown={(event) => handleImageKeydown(event, item)}
							aria-label={`Select or drag ${item.alt ?? 'image'}`}
						>
							<span class="sr-only">Select {item.alt ?? 'image'}</span>
						</button>
						{#if selectedItemId === item.id}
							<button type="button" class="remove-image" on:click={() => removeImage(item.id)} aria-label={`Remove ${item.alt ?? 'image'}`}>
								×
							</button>
							<button
								type="button"
								class="rotate-image"
								on:pointerdown={(event) => startImageRotate(event, item)}
								on:pointermove={rotateImage}
								on:pointerup={endImageRotate}
								on:pointercancel={endImageRotate}
								on:keydown={(event) => handleRotateKeydown(event, item)}
								aria-label={`Rotate ${item.alt ?? 'image'}`}
							>
								⟳
							</button>
							<button
								type="button"
								class="resize-image"
								on:pointerdown={(event) => startImageResize(event, item)}
								on:pointermove={resizeImage}
								on:pointerup={endImageResize}
								on:pointercancel={endImageResize}
								on:keydown={(event) => handleResizeKeydown(event, item)}
								aria-label={`Resize ${item.alt ?? 'image'}`}
							>
								↘
							</button>
						{/if}
					</div>
				{/each}
			</div>

			{#if !items.length && !strokes.length}
				<div class="empty-state" aria-hidden="true">
					<div>{isUploading ? 'Adding your picture…' : 'Drop a picture anywhere'}</div>
					<span>Then write directly on the page</span>
				</div>
			{/if}
		</div>
	</div>

	<div class="drawing-tools" aria-label="Drawing tools">
		<button type="button" class:active={currentTool === 'pencil'} aria-pressed={currentTool === 'pencil'} on:click={() => setTool('pencil')}>
			✏️ Pen
		</button>
		<button type="button" class:active={currentTool === 'eraser'} aria-pressed={currentTool === 'eraser'} on:click={() => setTool('eraser')}>
			🧽 Eraser
		</button>
	</div>

	<p class="sr-only" aria-live="polite">{statusMessage}</p>
</section>

<style>
	.canvas-shell {
		position: fixed;
		inset: 0;
		z-index: 10;
		pointer-events: none;
	}

	.board-frame {
		position: fixed;
		inset: 0;
		z-index: 0;
		min-height: 100svh;
		pointer-events: auto;
	}

	.canvas-board {
		position: relative;
		isolation: isolate;
		overflow: hidden;
		width: 100vw;
		height: 100svh;
		min-height: 100svh;
		background:
			radial-gradient(circle at 10% 12%, rgba(255, 199, 218, 0.38), transparent 24rem),
			radial-gradient(circle at 88% 18%, rgba(179, 136, 255, 0.22), transparent 20rem),
			radial-gradient(circle at 50% 92%, rgba(255, 111, 160, 0.16), transparent 24rem),
			linear-gradient(135deg, #fff7fb 0%, #ffe4ef 45%, #f9edff 100%);
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
		z-index: 4;
		touch-action: none;
		pointer-events: auto;
		cursor: crosshair;
	}

	.drawing-layer.eraser-enabled {
		cursor: cell;
	}

	.canvas-item,
	.image-controls {
		position: absolute;
		display: block;
		min-width: 4rem;
		transform-origin: center;
	}

	.canvas-item {
		z-index: 3;
		pointer-events: none;
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

	.image-controls-layer {
		position: absolute;
		inset: 0;
		z-index: 5;
		pointer-events: none;
	}

	.image-controls {
		pointer-events: none;
	}

	.image-controls.selected {
		filter: drop-shadow(0 0 0.7rem rgba(255, 95, 159, 0.18));
	}

	.control-measure {
		display: block;
		width: 100%;
		height: auto;
		opacity: 0;
		pointer-events: none;
		user-select: none;
		-webkit-user-drag: none;
	}

	.select-image {
		position: absolute;
		inset: 0;
		z-index: 0;
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		border-radius: 1rem;
		background: transparent;
		box-shadow: none;
		cursor: grab;
		pointer-events: auto;
	}

	.select-image:active {
		cursor: grabbing;
	}

	.select-image:hover,
	.select-image:focus-visible,
	.image-controls.selected .select-image {
		outline: 3px solid rgba(255, 95, 159, 0.45);
		outline-offset: 4px;
	}

	.remove-image,
	.rotate-image,
	.resize-image {
		position: absolute;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 0;
		border-radius: 999px;
		font: inherit;
		font-size: 1.1rem;
		font-weight: 950;
		line-height: 1;
		color: #fff;
		background: linear-gradient(135deg, #ff5f9f, #9d6bff);
		box-shadow: 0 12px 28px rgba(111, 39, 78, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.5);
		cursor: pointer;
		opacity: 0.82;
		pointer-events: auto;
		transition: transform 160ms ease, opacity 160ms ease, box-shadow 160ms ease;
	}

	.remove-image {
		top: -0.8rem;
		right: -0.8rem;
	}

	.rotate-image {
		left: -0.8rem;
		bottom: -0.8rem;
		cursor: grab;
		touch-action: none;
	}

	.rotate-image:active {
		cursor: grabbing;
	}

	.resize-image {
		right: -0.8rem;
		bottom: -0.8rem;
		cursor: nwse-resize;
		touch-action: none;
	}

	.remove-image:hover,
	.remove-image:focus-visible,
	.rotate-image:hover,
	.rotate-image:focus-visible,
	.resize-image:hover,
	.resize-image:focus-visible {
		transform: scale(1.08);
		opacity: 1;
		box-shadow: 0 16px 34px rgba(111, 39, 78, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.5);
		outline: none;
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

	.drawing-tools {
		position: fixed;
		left: 50%;
		bottom: max(7.25rem, calc(env(safe-area-inset-bottom) + 6.75rem));
		z-index: 6;
		display: flex;
		gap: 0.55rem;
		padding: 0.55rem;
		border: 1px solid rgba(255, 255, 255, 0.68);
		border-radius: 999px;
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.66), rgba(255, 226, 240, 0.76));
		box-shadow: 0 24px 70px rgba(150, 44, 92, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(22px) saturate(1.4);
		pointer-events: auto;
		transform: translateX(-50%);
	}

	.drawing-tools button {
		border: 0;
		border-radius: 999px;
		padding: 0.65rem 0.95rem;
		font: inherit;
		font-weight: 850;
		color: #6b2842;
		background: rgba(255, 255, 255, 0.92);
		box-shadow: 0 10px 24px rgba(160, 50, 100, 0.13), inset 0 1px 0 #fff;
		cursor: pointer;
		transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
	}

	.drawing-tools button:hover,
	.drawing-tools button:focus-visible {
		transform: translateY(-1px);
		box-shadow: 0 14px 30px rgba(160, 50, 100, 0.18), inset 0 1px 0 #fff;
		outline: none;
	}

	.drawing-tools button.active {
		color: #fff;
		background: linear-gradient(135deg, #ff5f9f, #9d6bff);
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
		.drawing-tools {
			bottom: max(6.2rem, calc(env(safe-area-inset-bottom) + 5.8rem));
			gap: 0.4rem;
			padding: 0.45rem;
		}

		.drawing-tools button {
			padding: 0.62rem 0.8rem;
		}

		.canvas-item,
		.image-controls {
			min-width: 3rem;
		}
	}
</style>
