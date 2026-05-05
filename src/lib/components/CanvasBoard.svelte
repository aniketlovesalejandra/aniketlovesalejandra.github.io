<script>
	import { onMount, tick } from 'svelte';
	import {
		authEmailToUsername,
		fileToDataUrl,
		getCanvasImageDisplayUrl,
		getSession,
		hasSupabaseConfig,
		loadCanvasState,
		onAuthChange,
		saveCanvasState,
		signInWithPassword,
		signOut,
		uploadCanvasImage
	} from '$lib/services/supabaseClient';

	let boardEl;
	let drawingCanvas;
	let resizeObserver;
	let toolsPositionObserver;
	let saveTimer;

	let items = [];
	let strokes = [];
	let currentStroke = null;
	let currentTool = 'pencil';
	let currentResize = null;
	let currentDrag = null;
	let currentRotate = null;
	let brushColor = '#9747ff';
	let selectedItemId = null;
	let eraserPreview = { x: 0, y: 0, visible: false };
	let isDrawing = false;
	let isUploading = false;
	let isLoaded = false;
	let authSession = null;
	let authUsername = '';
	let authPassword = '';
	let authMessage = '';
	let authError = '';
	let isAuthBusy = false;
	let failedImageIds = [];
	let imageDisplayUrls = {};
	let signedUrlAttemptIds = [];
	let statusMessage = 'Loading your forever canvas…';
	let drawingToolsStyle = '';

	const brush = {
		width: 4
	};

	const penColors = [
		{ label: 'Purple', value: '#9747ff' },
		{ label: 'Pink', value: '#ff5f9f' },
		{ label: 'Red', value: '#ff477e' },
		{ label: 'Blue', value: '#38a3ff' },
		{ label: 'Green', value: '#2ecf8f' },
		{ label: 'Gold', value: '#ffb703' }
	];

	const eraser = {
		width: 28
	};

	$: canSaveForever = hasSupabaseConfig && Boolean(authSession?.user);

	onMount(async () => {
		const unsubscribe = onAuthChange((session) => {
			authSession = session;

			if (session?.user) {
				authError = '';
				authMessage = 'Signed in. Future changes save forever.';
			}
		});

		try {
			authSession = await getSession();
		} catch (error) {
			console.warn('Unable to read Supabase session', error);
		}

		await loadInitialState();
		await tick();
		resizeDrawingCanvas();
		updateDrawingToolsPosition();

		if (typeof ResizeObserver !== 'undefined' && boardEl) {
			resizeObserver = new ResizeObserver(resizeDrawingCanvas);
			resizeObserver.observe(boardEl);
		}

		const dateHeading = document.querySelector('.date-header h1');
		if (typeof ResizeObserver !== 'undefined' && dateHeading) {
			toolsPositionObserver = new ResizeObserver(updateDrawingToolsPosition);
			toolsPositionObserver.observe(dateHeading);
		}

		window.addEventListener('resize', updateDrawingToolsPosition);

		return () => {
			unsubscribe();
			resizeObserver?.disconnect();
			toolsPositionObserver?.disconnect();
			window.removeEventListener('resize', updateDrawingToolsPosition);
			window.clearTimeout(saveTimer);
		};
	});

	async function handleSignInSubmit() {
		const username = authUsername.trim();
		if (!username || !authPassword) return;

		isAuthBusy = true;
		authError = '';
		authMessage = '';

		try {
			const { data, error } = await signInWithPassword(username, authPassword);

			if (error) {
				throw error;
			}

			authSession = data.session;
			authPassword = '';
			authMessage = 'Signed in. Saving this canvas forever…';

			try {
				await saveCanvasState(
					{
						version: 1,
						items,
						strokes
					},
					{ remote: true }
				);

				statusMessage = 'Saved forever 💌';
				authMessage = 'Signed in. This canvas is now saving forever.';
			} catch (saveError) {
				console.error('Initial permanent save failed', saveError);
				statusMessage = 'Permanent save failed. A safe local draft was saved instead.';
				authError = saveError?.message ?? 'Signed in, but the permanent save failed.';
			}
		} catch (error) {
			console.error('Supabase sign-in failed', error);
			authError = error?.message ?? 'Unable to sign in.';
		} finally {
			isAuthBusy = false;
		}
	}

	function authDisplayName(session) {
		return authEmailToUsername(session?.user?.email);
	}

	async function handleSignOut() {
		isAuthBusy = true;
		authError = '';

		try {
			await signOut();
			authSession = null;
			authMessage = 'Signed out. New changes save locally until you sign in again.';
		} catch (error) {
			console.error('Supabase sign-out failed', error);
			authError = error?.message ?? 'Unable to sign out.';
		} finally {
			isAuthBusy = false;
		}
	}

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

	function updateDrawingToolsPosition() {
		if (typeof document === 'undefined') return;

		const dateHeading = document.querySelector('.date-header h1');
		if (!dateHeading) return;

		const offset = window.innerWidth <= 720 ? 10 : 12;
		const top = Math.round(dateHeading.getBoundingClientRect().bottom + offset);
		drawingToolsStyle = `top: ${top}px`;
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
		const strokeColor = isEraser ? 'rgba(0, 0, 0, 1)' : (stroke.color ?? brushColor);

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
		eraserPreview = { ...eraserPreview, visible: false };
	}

	function selectPenColor(color) {
		brushColor = color;
		currentTool = 'pencil';
		eraserPreview = { ...eraserPreview, visible: false };
		statusMessage = 'Pen color changed.';
	}

	function updateEraserPreview(event) {
		if (currentTool !== 'eraser' || !boardEl) {
			eraserPreview = { ...eraserPreview, visible: false };
			return;
		}

		const rect = boardEl.getBoundingClientRect();
		eraserPreview = {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
			visible: true
		};
	}

	function hideEraserPreview() {
		if (!isDrawing) {
			eraserPreview = { ...eraserPreview, visible: false };
		}
	}

	function startDrawing(event) {
		if (!isLoaded) return;

		event.preventDefault();
		updateEraserPreview(event);
		selectedItemId = null;
		drawingCanvas.setPointerCapture?.(event.pointerId);
		const tool = currentTool === 'eraser' ? 'eraser' : 'pencil';
		const isEraser = tool === 'eraser';
		isDrawing = true;
		currentStroke = {
			id: createId('stroke'),
			tool,
			color: brushColor,
			width: isEraser ? eraser.width : brush.width,
			points: [getPointerPoint(event)]
		};
		redrawAll(currentStroke);
	}

	function handleDrawingPointerMove(event) {
		updateEraserPreview(event);
		continueDrawing(event);
	}

	function handleDrawingPointerUp(event) {
		endDrawing(event);
		updateEraserPreview(event);
	}

	function handleDrawingPointerCancel(event) {
		endDrawing(event);
		eraserPreview = { ...eraserPreview, visible: false };
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

	function imageLoadFailed(item) {
		return failedImageIds.includes(item.id);
	}

	function imageDisplaySrc(item) {
		return imageDisplayUrls[item.id] ?? item.src;
	}

	function handleImageLoad(item) {
		if (imageLoadFailed(item)) {
			failedImageIds = failedImageIds.filter((id) => id !== item.id);
		}
	}

	async function handleImageError(item) {
		if (!signedUrlAttemptIds.includes(item.id)) {
			signedUrlAttemptIds = [...signedUrlAttemptIds, item.id];

			try {
				const displayUrl = await getCanvasImageDisplayUrl(item.src);

				if (displayUrl && displayUrl !== item.src) {
					imageDisplayUrls = { ...imageDisplayUrls, [item.id]: displayUrl };
					statusMessage = 'Image uploaded. Using a private signed URL to display it.';
					return;
				}
			} catch (error) {
				console.error('Unable to create a signed image URL', error);
			}
		}

		if (!imageLoadFailed(item)) {
			failedImageIds = [...failedImageIds, item.id];
		}

		if (typeof item.src === 'string' && item.src.includes('/storage/v1/object/public/')) {
			statusMessage = 'Image uploaded, but its public URL is blocked. Make the canvas-uploads bucket public.';
		} else {
			statusMessage = 'Image saved, but this browser could not display it.';
		}
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
				on:pointermove={handleDrawingPointerMove}
				on:pointerup={handleDrawingPointerUp}
				on:pointercancel={handleDrawingPointerCancel}
				on:pointerleave={hideEraserPreview}
				on:mousemove={updateEraserPreview}
				on:mouseleave={hideEraserPreview}
				aria-label="Always-on drawing layer"
			/>

			{#if currentTool === 'eraser' && eraserPreview.visible}
				<div
					class="eraser-outline"
					style={`left: ${eraserPreview.x}px; top: ${eraserPreview.y}px; width: ${eraser.width}px; height: ${eraser.width}px`}
					aria-hidden="true"
				></div>
			{/if}

			{#each items as item (item.id)}
				<div class="canvas-item" class:image-load-failed={imageLoadFailed(item)} style={itemStyle(item)}>
					<img src={imageDisplaySrc(item)} alt={item.alt ?? ''} draggable="false" on:load={() => handleImageLoad(item)} on:error={() => handleImageError(item)} />
					{#if imageLoadFailed(item)}
						<span class="image-fallback">Image saved, URL blocked</span>
					{/if}
				</div>
			{/each}

			<div class="image-controls-layer" aria-label="Image controls">
				{#each items as item (item.id)}
					<div class="image-controls" class:selected={selectedItemId === item.id} class:image-load-failed={imageLoadFailed(item)} style={itemStyle(item, 20)}>
						<img class="control-measure" src={imageDisplaySrc(item)} alt="" draggable="false" />
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

	<div class="drawing-tools" style={drawingToolsStyle} aria-label="Drawing tools">
		<div class="tool-icons" aria-label="Pen and eraser">
			<button type="button" class="tool-icon" class:active={currentTool === 'pencil'} aria-label="Draw" aria-pressed={currentTool === 'pencil'} title="Draw" on:click={() => setTool('pencil')}>
				✏️
			</button>
			<button type="button" class="tool-icon" class:active={currentTool === 'eraser'} aria-label="Erase" aria-pressed={currentTool === 'eraser'} title="Erase" on:click={() => setTool('eraser')}>
				🧽
			</button>
		</div>

		<div class="color-palette" aria-label="Pen colors">
			{#each penColors as color}
				<button
					type="button"
					class="color-swatch"
					class:active={currentTool === 'pencil' && brushColor === color.value}
					style={`--swatch-color: ${color.value}`}
					aria-label={`Use ${color.label} pen`}
					title={`${color.label} pen`}
					on:click={() => selectPenColor(color.value)}
				>
					<span class="sr-only">{color.label}</span>
				</button>
			{/each}
		</div>
	</div>

	{#if hasSupabaseConfig}
		<form class="sync-panel" aria-label="Forever save status" on:submit|preventDefault={handleSignInSubmit}>
			<div class="sync-copy">
				<strong>{canSaveForever ? 'Forever save is on' : 'Local draft only'}</strong>
				<span>{canSaveForever ? authDisplayName(authSession) : 'Sign in with your username and password to save across devices.'}</span>
				<small>{statusMessage}</small>
			</div>

			{#if canSaveForever}
				<button type="button" class="sync-button" disabled={isAuthBusy} on:click={handleSignOut}>Sign out</button>
			{:else}
				<label class="sr-only" for="canvas-auth-username">Username</label>
				<input id="canvas-auth-username" type="text" bind:value={authUsername} autocomplete="username" placeholder="username" disabled={isAuthBusy} required />
				<label class="sr-only" for="canvas-auth-password">Password</label>
				<input id="canvas-auth-password" type="password" bind:value={authPassword} autocomplete="current-password" placeholder="password" disabled={isAuthBusy} required />
				<button type="submit" class="sync-button" disabled={isAuthBusy}>{isAuthBusy ? 'Signing in…' : 'Sign in'}</button>
			{/if}

			{#if authMessage}
				<p class="auth-message">{authMessage}</p>
			{/if}

			{#if authError}
				<p class="auth-error">{authError}</p>
			{/if}
		</form>
	{:else}
		<div class="sync-panel local-only" aria-label="Forever save status">
			<div class="sync-copy">
				<strong>Local draft only</strong>
				<span>Add Supabase keys before building to save across devices.</span>
				<small>{statusMessage}</small>
			</div>
		</div>
	{/if}

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
		cursor: none;
	}

	.eraser-outline {
		position: absolute;
		z-index: 6;
		border: 2px solid rgba(99, 39, 69, 0.72);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.16);
		box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6), 0 8px 22px rgba(104, 43, 76, 0.16);
		pointer-events: none;
		transform: translate(-50%, -50%);
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

	.canvas-item.image-load-failed,
	.image-controls.image-load-failed {
		aspect-ratio: 4 / 3;
		min-height: 4rem;
	}

	.canvas-item.image-load-failed {
		display: grid;
		place-items: center;
		padding: 0.65rem;
		border: 1px solid rgba(196, 47, 98, 0.28);
		border-radius: 1rem;
		color: #8c2d52;
		background: rgba(255, 255, 255, 0.78);
		box-shadow: 0 18px 42px rgba(93, 32, 62, 0.14);
		text-align: center;
	}

	.canvas-item.image-load-failed img {
		display: none;
	}

	.image-fallback {
		font-size: 0.74rem;
		font-weight: 900;
		line-height: 1.25;
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

	.image-controls.image-load-failed .control-measure {
		height: 100%;
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
		top: clamp(5.2rem, 11.5vw, 8.85rem);
		z-index: 6;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.26rem;
		border: 1px solid rgba(255, 255, 255, 0.68);
		border-radius: 999px;
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.66), rgba(255, 226, 240, 0.76));
		box-shadow: 0 12px 28px rgba(150, 44, 92, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(22px) saturate(1.4);
		pointer-events: auto;
		transform: translateX(-50%);
	}

	.tool-icons,
	.color-palette {
		display: flex;
		align-items: center;
		gap: 0.18rem;
	}

	.tool-icons {
		padding-right: 0.22rem;
		border-right: 1px solid rgba(142, 63, 99, 0.12);
	}

	.drawing-tools button {
		border: 0;
		border-radius: 999px;
		font: inherit;
		color: #6b2842;
		background: rgba(255, 255, 255, 0.92);
		box-shadow: 0 6px 14px rgba(160, 50, 100, 0.11), inset 0 1px 0 #fff;
		cursor: pointer;
		transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
	}

	.tool-icon {
		display: grid;
		place-items: center;
		width: 1.62rem;
		height: 1.62rem;
		padding: 0;
		font-size: 0.78rem;
		font-weight: 850;
	}

	.color-swatch {
		display: grid;
		place-items: center;
		width: 1.08rem;
		height: 1.08rem;
		padding: 0;
	}

	.drawing-tools .color-swatch {
		background-color: var(--swatch-color);
		background-image: linear-gradient(145deg, rgba(255, 255, 255, 0.34), transparent 48%);
		box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.94), 0 6px 12px rgba(115, 37, 78, 0.1);
	}

	.drawing-tools button:hover,
	.drawing-tools button:focus-visible {
		transform: translateY(-1px);
		box-shadow: 0 10px 18px rgba(160, 50, 100, 0.17), inset 0 1px 0 #fff;
		outline: none;
	}

	.tool-icon.active {
		color: #fff;
		background: linear-gradient(135deg, #ff5f9f, #9d6bff);
	}

	.drawing-tools .color-swatch.active {
		outline: 1.5px solid #fff;
		outline-offset: 1.5px;
		box-shadow: 0 0 0 3px rgba(255, 95, 159, 0.36), 0 8px 14px rgba(115, 37, 78, 0.16);
	}

	.sync-panel {
		position: fixed;
		top: clamp(1rem, 2.8vw, 1.7rem);
		right: clamp(1rem, 3vw, 2rem);
		z-index: 7;
		display: grid;
		gap: 0.56rem;
		width: min(21rem, calc(100vw - 2rem));
		padding: 0.78rem;
		border: 1px solid rgba(255, 255, 255, 0.72);
		border-radius: 1.15rem;
		color: #5f2139;
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.82), rgba(255, 226, 240, 0.88));
		box-shadow: 0 16px 36px rgba(150, 44, 92, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(22px) saturate(1.35);
		pointer-events: auto;
	}

	.sync-copy {
		display: grid;
		gap: 0.18rem;
	}

	.sync-copy strong {
		font-size: 0.82rem;
		font-weight: 950;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.sync-copy span,
	.sync-copy small {
		color: #87516a;
		font-size: 0.76rem;
		font-weight: 760;
		line-height: 1.35;
	}

	.sync-copy small {
		color: #a65d7d;
		font-size: 0.72rem;
	}

	.sync-panel input {
		width: 100%;
		min-width: 0;
		padding: 0.58rem 0.7rem;
		border: 1px solid rgba(151, 71, 255, 0.18);
		border-radius: 0.8rem;
		color: #5f2139;
		background: rgba(255, 255, 255, 0.9);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
		font-size: 0.82rem;
		font-weight: 760;
	}

	.sync-panel input:focus {
		border-color: rgba(255, 95, 159, 0.54);
		outline: 3px solid rgba(255, 95, 159, 0.22);
	}

	.sync-button {
		justify-self: start;
		padding: 0.54rem 0.8rem;
		border: 0;
		border-radius: 999px;
		color: #fff;
		background: linear-gradient(135deg, #ff5f9f, #9d6bff);
		box-shadow: 0 12px 24px rgba(111, 39, 78, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.45);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 900;
		cursor: pointer;
		transition: transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
	}

	.sync-button:hover,
	.sync-button:focus-visible {
		transform: translateY(-1px);
		box-shadow: 0 16px 30px rgba(111, 39, 78, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.45);
		outline: none;
	}

	.sync-button:disabled,
	.sync-panel input:disabled {
		cursor: wait;
		opacity: 0.62;
	}

	.auth-message,
	.auth-error {
		margin: 0;
		font-size: 0.74rem;
		font-weight: 800;
		line-height: 1.35;
	}

	.auth-message {
		color: #7d4bc8;
	}

	.auth-error {
		color: #c42f62;
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
		.sync-panel {
			top: auto;
			right: 0.75rem;
			bottom: 6.4rem;
			left: 0.75rem;
			width: auto;
			padding: 0.64rem;
		}

		.sync-copy small {
			display: none;
		}

		.drawing-tools {
			top: clamp(4.6rem, 22vw, 6.2rem);
			gap: 0.2rem;
			padding: 0.22rem;
		}

		.tool-icon {
			width: 1.5rem;
			height: 1.5rem;
			font-size: 0.72rem;
		}

		.color-swatch {
			width: 1rem;
			height: 1rem;
		}

		.canvas-item,
		.image-controls {
			min-width: 3rem;
		}
	}
</style>
