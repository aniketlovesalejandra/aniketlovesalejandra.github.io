<script>
	import { onMount, tick } from 'svelte';
	import {
		fileToDataUrl,
		getCanvasImageDisplayUrl,
		hasSupabaseConfig,
		loadCanvasState,
		saveCanvasState,
		subscribeToCanvasState,
		uploadCanvasImage
	} from '$lib/services/supabaseClient';

	export let authSession = null;

	let boardEl;
	let saveTimer;
	let syncTimer;

	let items = [];
	let currentDrag = null;
	let currentResize = null;
	let currentRotate = null;
	let selectedItemId = null;
	let editingTextId = null;
	let isUploading = false;
	let isSaving = false;
	let isLoaded = false;
	let failedImageIds = [];
	let imageDisplayUrls = {};
	let signedUrlAttemptIds = [];
	let signedUrlRetryCount = {};
	let latestCanvasUpdatedAt = null;
	let statusMessage = 'Loading your forever canvas…';
	let fileInputEl;

	// ── Long-press / context menu ────────────────────────────────
	let contextMenu = { visible: false, x: 0, y: 0, boardX: 0, boardY: 0 };
	let longPressTimer = null;
	let longPressStartPos = null;
	let longPressMoved = false;
	let pendingPhotoPos = null;
	const LONG_PRESS_MS = 500;

	// ── Text style options ───────────────────────────────────────
	const textColors = [
		{ label: 'Rose',   value: '#c2185b' },
		{ label: 'Purple', value: '#7b1fa2' },
		{ label: 'Blue',   value: '#1565c0' },
		{ label: 'Teal',   value: '#00695c' },
		{ label: 'Gold',   value: '#e65100' },
		{ label: 'Ink',    value: '#1a1a2e'  }
	];
	let activeTextColor = '#c2185b';

	const fontSizes = [14, 18, 24, 32, 48];
	let activeTextSize = 24;

	const fontFamilies = [
		{ label: 'Serif',  value: "Georgia, 'Times New Roman', serif" },
		{ label: 'Sans',   value: "system-ui, 'Segoe UI', sans-serif" },
		{ label: 'Script', value: "'Segoe Script', 'Bradley Hand', cursive" },
		{ label: 'Mono',   value: "'Courier New', monospace" }
	];
	let activeFont = fontFamilies[0].value;

	$: canSaveForever = hasSupabaseConfig && Boolean(authSession?.user);

	onMount(() => {
		let isDisposed = false;
		let unsubscribeCanvas = () => {};

		async function initializeCanvas() {
			await loadInitialState();
			if (isDisposed) return;
			await tick();
			unsubscribeCanvas = startCanvasSync();
		}

		void initializeCanvas();

		return () => {
			isDisposed = true;
			unsubscribeCanvas();
			window.clearTimeout(saveTimer);
			window.clearInterval(syncTimer);
			if (longPressTimer) window.clearTimeout(longPressTimer);
		};
	});

	function createId(prefix) {
		if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
		return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

	function normalizeAngle(value) {
		return ((((value + 180) % 360) + 360) % 360) - 180;
	}

	async function loadInitialState() {
		try {
			const state = await loadCanvasState();
			items = (state.items ?? []).filter((i) => i.type === 'image' || i.type === 'text');
			latestCanvasUpdatedAt = state.updatedAt;
			isLoaded = true;
			statusMessage = state.updatedAt
				? `Loaded the canvas saved ${formatTimestamp(state.updatedAt)}.`
				: 'Long-press anywhere to add a note or photo.';
		} catch (error) {
			console.error('Canvas load failed', error);
			isLoaded = true;
			statusMessage = 'Could not load the permanent canvas. A local draft is ready.';
		}
	}

	function formatTimestamp(value) {
		try {
			return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
		} catch { return 'recently'; }
	}

	function timestampValue(value) {
		const time = Date.parse(value ?? '');
		return Number.isNaN(time) ? 0 : time;
	}

	function remoteStateIsNewer(state) {
		return timestampValue(state?.updatedAt) > timestampValue(latestCanvasUpdatedAt);
	}

	function isCanvasBusy() {
		return Boolean(isUploading || isSaving || currentResize || currentDrag || currentRotate || saveTimer || editingTextId);
	}

	async function applyRemoteCanvasState(state) {
		if (!remoteStateIsNewer(state) || isCanvasBusy()) return;

		items = (state.items ?? []).filter((i) => i.type === 'image' || i.type === 'text');
		latestCanvasUpdatedAt = state.updatedAt;

		const itemIds = new Set(items.map((item) => item.id));
		failedImageIds = failedImageIds.filter((id) => itemIds.has(id));
		signedUrlAttemptIds = signedUrlAttemptIds.filter((id) => itemIds.has(id));
		signedUrlRetryCount = Object.fromEntries(Object.entries(signedUrlRetryCount).filter(([id]) => itemIds.has(id)));
		imageDisplayUrls = Object.fromEntries(Object.entries(imageDisplayUrls).filter(([id]) => itemIds.has(id)));

		if (selectedItemId && !itemIds.has(selectedItemId)) selectedItemId = null;

		await tick();
		statusMessage = `Live canvas updated ${formatTimestamp(state.updatedAt)}.`;
	}

	async function refreshCanvasStateFromRemote() {
		if (!hasSupabaseConfig || isCanvasBusy()) return;
		try {
			await applyRemoteCanvasState(await loadCanvasState());
		} catch (error) {
			console.warn('Unable to refresh live canvas state', error);
		}
	}

	function startCanvasSync() {
		if (!hasSupabaseConfig) return () => {};
		const unsubscribeRealtime = subscribeToCanvasState((state) => { void applyRemoteCanvasState(state); });
		syncTimer = window.setInterval(refreshCanvasStateFromRemote, 30000);
		return () => { unsubscribeRealtime(); window.clearInterval(syncTimer); };
	}

	// ── Item helpers ─────────────────────────────────────────────

	function itemStyle(item, zOffset = 0) {
		const parts = [
			`left: ${item.x}%`,
			`top: ${item.y}%`,
			`transform: rotate(${item.rotation ?? 0}deg)`,
			`z-index: ${(item.z ?? 1) + zOffset}`
		];
		if (item.type === 'image') parts.push(`width: ${item.width}%`);
		return parts.join('; ');
	}

	function nextZIndex() {
		return Math.max(1, ...items.map((i) => i.z ?? 1)) + 1;
	}

	function textVars(item) {
		return [
			`--text-color: ${item.color ?? activeTextColor}`,
			`--text-size: ${item.fontSize ?? activeTextSize}px`,
			`--text-font: ${item.fontFamily ?? activeFont}`
		].join('; ');
	}

	// ── Long-press → context menu ─────────────────────────────────

	function boardPointerDown(event) {
		if (event.target !== boardEl) return;
		if (!isLoaded) return;
		if (contextMenu.visible) { closeContextMenu(); return; }

		selectedItemId = null;
		longPressStartPos = { x: event.clientX, y: event.clientY };
		longPressMoved = false;

		longPressTimer = window.setTimeout(() => {
			longPressTimer = null;
			if (longPressMoved) return;
			const rect = boardEl.getBoundingClientRect();
			const boardX = clamp(((longPressStartPos.x - rect.left) / rect.width) * 100, 2, 74);
			const boardY = clamp(((longPressStartPos.y - rect.top) / rect.height) * 100, 2, 84);
			contextMenu = { visible: true, x: longPressStartPos.x, y: longPressStartPos.y, boardX, boardY };
		}, LONG_PRESS_MS);
	}

	function boardPointerMove(event) {
		if (!longPressTimer || !longPressStartPos) return;
		const dx = event.clientX - longPressStartPos.x;
		const dy = event.clientY - longPressStartPos.y;
		if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
			longPressMoved = true;
			window.clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function boardPointerUp() {
		if (longPressTimer) { window.clearTimeout(longPressTimer); longPressTimer = null; }
	}

	function boardPointerCancel() {
		if (longPressTimer) { window.clearTimeout(longPressTimer); longPressTimer = null; }
	}

	function closeContextMenu() {
		contextMenu = { ...contextMenu, visible: false };
	}

	function addTextAtMenu() {
		const id = createId('text');
		items = [...items, {
			id, type: 'text', text: '',
			x: contextMenu.boardX, y: contextMenu.boardY,
			color: activeTextColor, fontSize: activeTextSize,
			fontFamily: activeFont, rotation: 0, z: nextZIndex()
		}];
		selectedItemId = id;
		editingTextId = id;
		closeContextMenu();
	}

	function addPhotoAtMenu() {
		pendingPhotoPos = { x: contextMenu.boardX, y: contextMenu.boardY };
		closeContextMenu();
		openFilePicker();
	}

	// ── Text editing ─────────────────────────────────────────────

	function startEditingText(event, item) {
		event.stopPropagation();
		selectedItemId = item.id;
		editingTextId = item.id;
	}

	function handleTextInput(event, item) {
		items = items.map((i) => (i.id === item.id ? { ...i, text: event.target.value } : i));
	}

	function commitText(item) {
		editingTextId = null;
		if (!item.text?.trim()) {
			items = items.filter((i) => i.id !== item.id);
			if (selectedItemId === item.id) selectedItemId = null;
		} else {
			scheduleSave();
		}
	}

	function handleTextKeydown(event) {
		if (event.key === 'Escape') event.currentTarget.blur();
		if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); }
	}

	// ── Select / remove ──────────────────────────────────────────

	function selectItem(event, item) {
		event.preventDefault();
		event.stopPropagation();
		selectedItemId = item.id;
		if (item.type === 'text') {
			if (item.color) activeTextColor = item.color;
			if (item.fontSize) activeTextSize = item.fontSize;
			if (item.fontFamily) activeFont = item.fontFamily;
		}
	}

	function removeItem(itemId) {
		items = items.filter((i) => i.id !== itemId);
		if (selectedItemId === itemId) selectedItemId = null;
		if (editingTextId === itemId) editingTextId = null;
		statusMessage = 'Item removed.';
		scheduleSave();
	}

	// ── Toolbar style apply helpers ───────────────────────────────

	function applyTextColor(value) {
		activeTextColor = value;
		const sel = items.find((i) => i.id === selectedItemId && i.type === 'text');
		if (sel) { items = items.map((i) => i.id === sel.id ? { ...i, color: value } : i); scheduleSave(); }
	}

	function applyTextSize(value) {
		activeTextSize = value;
		const sel = items.find((i) => i.id === selectedItemId && i.type === 'text');
		if (sel) { items = items.map((i) => i.id === sel.id ? { ...i, fontSize: value } : i); scheduleSave(); }
	}

	function applyTextFont(value) {
		activeFont = value;
		const sel = items.find((i) => i.id === selectedItemId && i.type === 'text');
		if (sel) { items = items.map((i) => i.id === sel.id ? { ...i, fontFamily: value } : i); scheduleSave(); }
	}

	// ── Drag ─────────────────────────────────────────────────────

	function startDrag(event, item) {
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		selectedItemId = item.id;
		if (item.type === 'text') {
			if (item.color) activeTextColor = item.color;
			if (item.fontSize) activeTextSize = item.fontSize;
			if (item.fontFamily) activeFont = item.fontFamily;
		}

		const rect = boardEl.getBoundingClientRect();
		currentDrag = {
			id: item.id,
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startX: item.x,
			startY: item.y,
			width: item.width ?? 0,
			boardWidth: rect.width,
			boardHeight: rect.height,
			moved: false
		};
		items = items.map((i) => (i.id === item.id ? { ...i, z: nextZIndex() } : i));
	}

	function onDragMove(event) {
		if (!currentDrag || event.pointerId !== currentDrag.pointerId) return;
		event.preventDefault();
		event.stopPropagation();

		const deltaX = ((event.clientX - currentDrag.startClientX) / currentDrag.boardWidth) * 100;
		const deltaY = ((event.clientY - currentDrag.startClientY) / currentDrag.boardHeight) * 100;
		const moved = currentDrag.moved || Math.abs(deltaX) > 0.25 || Math.abs(deltaY) > 0.25;
		const maxX = currentDrag.width > 0 ? Math.max(0, 100 - currentDrag.width) : 96;
		currentDrag = { ...currentDrag, moved };

		items = items.map((i) =>
			i.id === currentDrag.id
				? { ...i, x: clamp(currentDrag.startX + deltaX, 0, maxX), y: clamp(currentDrag.startY + deltaY, 0, 92) }
				: i
		);
	}

	function endDrag(event) {
		if (!currentDrag || event.pointerId !== currentDrag.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		if (currentDrag.moved) { statusMessage = 'Item moved.'; scheduleSave(); }
		currentDrag = null;
	}

	// ── Resize (images only) ─────────────────────────────────────

	function startResize(event, item) {
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		const rect = boardEl.getBoundingClientRect();
		currentResize = { id: item.id, pointerId: event.pointerId, startX: event.clientX, startWidth: item.width, boardWidth: rect.width };
	}

	function onResizeMove(event) {
		if (!currentResize || event.pointerId !== currentResize.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		const delta = ((event.clientX - currentResize.startX) / currentResize.boardWidth) * 100;
		const width = clamp(currentResize.startWidth + delta, 8, 72);
		items = items.map((i) => (i.id === currentResize.id ? { ...i, width } : i));
	}

	function endResize(event) {
		if (!currentResize || event.pointerId !== currentResize.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		currentResize = null;
		statusMessage = 'Image resized.';
		scheduleSave();
	}

	// ── Rotate ───────────────────────────────────────────────────

	function pointerAngle(event, center) {
		return (Math.atan2(event.clientY - center.y, event.clientX - center.x) * 180) / Math.PI;
	}

	function startRotate(event, item) {
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		selectedItemId = item.id;
		const measure = event.currentTarget.parentElement?.querySelector('.control-measure');
		const r = measure?.getBoundingClientRect();
		if (!r) return;
		const center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		currentRotate = { id: item.id, pointerId: event.pointerId, center, startAngle: pointerAngle(event, center), startRotation: item.rotation ?? 0 };
	}

	function onRotateMove(event) {
		if (!currentRotate || event.pointerId !== currentRotate.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		const delta = normalizeAngle(pointerAngle(event, currentRotate.center) - currentRotate.startAngle);
		const rotation = Math.round(normalizeAngle(currentRotate.startRotation + delta) * 10) / 10;
		items = items.map((i) => (i.id === currentRotate.id ? { ...i, rotation } : i));
	}

	function endRotate(event) {
		if (!currentRotate || event.pointerId !== currentRotate.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		currentRotate = null;
		statusMessage = 'Item rotated.';
		scheduleSave();
	}

	// ── Image upload ─────────────────────────────────────────────

	function handleDragOver(event) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }

	function handleDrop(event) {
		event.preventDefault();
		const rect = boardEl.getBoundingClientRect();
		const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 4, 82);
		const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 4, 78);
		void addFiles(Array.from(event.dataTransfer.files), { x, y });
	}

	function openFilePicker() { fileInputEl?.click(); }

	async function handleFileInputChange(event) {
		const files = Array.from(event.target.files ?? []);
		event.target.value = '';
		if (!files.length) return;
		const placement = pendingPhotoPos ?? { x: 15, y: 20 };
		pendingPhotoPos = null;
		await addFiles(files, placement);
	}

	async function addFiles(files, placement) {
		const imageFiles = files.filter((f) => f.type.startsWith('image/'));
		if (!imageFiles.length) { statusMessage = 'Drop an image file onto the canvas.'; return; }

		isUploading = true;
		statusMessage = canSaveForever ? 'Uploading image forever…' : 'Adding image as a local draft…';

		try {
			const added = [];
			for (const [index, file] of imageFiles.entries()) {
				let src;
				try {
					src = await uploadCanvasImage(file, { remote: canSaveForever });
				} catch (err) {
					console.error('Image upload failed, using local draft', err);
					src = await fileToDataUrl(file);
					statusMessage = 'Upload failed, image added as local draft.';
				}
				added.push({
					id: createId('image'), type: 'image', src, alt: file.name || 'Canvas image',
					x: clamp(placement.x + index * 3, 4, 82), y: clamp(placement.y + index * 3, 4, 78),
					width: 24, rotation: index % 2 === 0 ? -2 : 2, z: nextZIndex() + index
				});
			}
			items = [...items, ...added];
			selectedItemId = null;
			scheduleSave();
		} finally {
			isUploading = false;
		}
	}

	// ── Image error / signed URL ─────────────────────────────────

	function imageLoadFailed(item) { return failedImageIds.includes(item.id); }
	function imageDisplaySrc(item) { return imageDisplayUrls[item.id] ?? item.src; }

	function handleImageLoad(item) {
		if (imageLoadFailed(item)) failedImageIds = failedImageIds.filter((id) => id !== item.id);
		if (item.id in signedUrlRetryCount) {
			const { [item.id]: _r, ...rest } = signedUrlRetryCount;
			signedUrlRetryCount = rest;
		}
	}

	async function handleImageError(item) {
		if (signedUrlAttemptIds.includes(item.id)) return;
		const retries = signedUrlRetryCount[item.id] ?? 0;
		if (retries < 2) {
			signedUrlAttemptIds = [...signedUrlAttemptIds, item.id];
			signedUrlRetryCount = { ...signedUrlRetryCount, [item.id]: retries + 1 };
			try {
				const displayUrl = await getCanvasImageDisplayUrl(item.src);
				if (displayUrl && displayUrl !== item.src) {
					imageDisplayUrls = { ...imageDisplayUrls, [item.id]: displayUrl };
					signedUrlAttemptIds = signedUrlAttemptIds.filter((id) => id !== item.id);
					statusMessage = 'Using a private signed URL to display image.';
					return;
				}
			} catch (err) { console.error('Unable to create signed URL', err); }
			signedUrlAttemptIds = signedUrlAttemptIds.filter((id) => id !== item.id);
		}
		if (!imageLoadFailed(item)) failedImageIds = [...failedImageIds, item.id];
		statusMessage = item.src?.includes('/storage/v1/object/public/')
			? 'Image URL blocked. Make the canvas-uploads bucket public.'
			: 'Image saved, but this browser could not display it.';
	}

	// ── Save ─────────────────────────────────────────────────────

	function scheduleSave() {
		if (!isLoaded) return;
		window.clearTimeout(saveTimer);
		statusMessage = canSaveForever ? 'Saving…' : 'Saving a local draft…';
		saveTimer = window.setTimeout(persistCanvasState, 650);
	}

	async function persistCanvasState() {
		window.clearTimeout(saveTimer);
		saveTimer = null;
		isSaving = true;
		try {
			const result = await saveCanvasState({ version: 1, items, strokes: [] }, { remote: canSaveForever });
			latestCanvasUpdatedAt = result.state.updatedAt;
			statusMessage = result.target === 'supabase'
				? 'Saved forever 💌'
				: hasSupabaseConfig ? 'Local draft saved. Sign in to make it permanent.' : 'Saved on this browser.';
		} catch (err) {
			console.error('Canvas save failed', err);
			await saveCanvasState({ version: 1, items, strokes: [] }, { remote: false });
			statusMessage = 'Permanent save failed. A safe local draft was saved instead.';
		} finally {
			isSaving = false;
		}
	}
</script>

<section class="canvas-shell" aria-label="Forever canvas">
	<div class="board-frame">
		<div
			bind:this={boardEl}
			class="canvas-board"
			role="region"
			aria-label="Canvas — long-press to add a note or photo"
			on:pointerdown={boardPointerDown}
			on:pointermove={boardPointerMove}
			on:pointerup={boardPointerUp}
			on:pointercancel={boardPointerCancel}
			on:contextmenu|preventDefault
			on:dragover={handleDragOver}
			on:drop={handleDrop}
		>
			<!-- Images -->
			{#each items.filter((i) => i.type === 'image') as item (item.id)}
				<div class="canvas-item image-item" class:load-failed={imageLoadFailed(item)} style={itemStyle(item)}>
					<img src={imageDisplaySrc(item)} alt={item.alt ?? ''} draggable="false"
						on:load={() => handleImageLoad(item)}
						on:error={() => handleImageError(item)} />
					{#if imageLoadFailed(item)}<span class="image-fallback">Image saved, URL blocked</span>{/if}
				</div>
			{/each}

			<!-- Text items -->
			{#each items.filter((i) => i.type === 'text') as item (item.id)}
				<div class="canvas-item text-item" class:selected={selectedItemId === item.id}
					style="{itemStyle(item)}; {textVars(item)}">
					{#if editingTextId === item.id}
						<textarea class="text-editor" value={item.text} placeholder="Type here…" rows="1" autofocus
							on:input={(e) => handleTextInput(e, item)}
							on:blur={() => commitText(item)}
							on:keydown={handleTextKeydown}
							on:pointerdown|stopPropagation></textarea>
					{:else}
						<div class="text-display" role="button" tabindex="0" aria-label="Edit text"
							on:pointerdown={(e) => startDrag(e, item)}
							on:pointermove={onDragMove}
							on:pointerup={endDrag}
							on:pointercancel={endDrag}
							on:click={(e) => selectItem(e, item)}
							on:dblclick={(e) => startEditingText(e, item)}
							on:keydown={(e) => { if (e.key === 'Enter') startEditingText(e, item); }}
						>{item.text || ''}</div>
					{/if}
				</div>
			{/each}

			<!-- Controls overlay -->
			<div class="controls-layer" aria-label="Item controls">
				{#each items as item (item.id)}
					<div class="item-controls" class:selected={selectedItemId === item.id} style={itemStyle(item, 20)}>
						{#if item.type === 'image'}
							<img class="control-measure" src={imageDisplaySrc(item)} alt="" draggable="false" />
						{:else}
							<div class="control-measure text-measure" style="font-size: {item.fontSize ?? 24}px; font-family: {item.fontFamily ?? "Georgia, serif"}">{item.text || '\u00a0'}</div>
						{/if}

						<button type="button" class="drag-handle"
							on:pointerdown={(e) => startDrag(e, item)}
							on:pointermove={onDragMove}
							on:pointerup={endDrag}
							on:pointercancel={endDrag}
							on:click={(e) => selectItem(e, item)}
							on:dblclick={(e) => { if (item.type === 'text') startEditingText(e, item); }}
							aria-label="Drag {item.type}">
							<span class="sr-only">Drag</span>
						</button>

						{#if selectedItemId === item.id}
							<button type="button" class="ctrl-btn remove-btn" on:click={() => removeItem(item.id)} aria-label="Remove">×</button>

							<button type="button" class="ctrl-btn rotate-btn"
								on:pointerdown={(e) => startRotate(e, item)}
								on:pointermove={onRotateMove}
								on:pointerup={endRotate}
								on:pointercancel={endRotate}
								aria-label="Rotate">⟳</button>

							{#if item.type === 'image'}
								<button type="button" class="ctrl-btn resize-btn"
									on:pointerdown={(e) => startResize(e, item)}
									on:pointermove={onResizeMove}
									on:pointerup={endResize}
									on:pointercancel={endResize}
									aria-label="Resize">↘</button>
							{/if}

							{#if item.type === 'text'}
								<button type="button" class="ctrl-btn edit-btn" on:click={(e) => startEditingText(e, item)} aria-label="Edit text">✎</button>
							{/if}
						{/if}
					</div>
				{/each}
			</div>

			{#if !items.length}
				<div class="empty-state" aria-hidden="true">
					<div>{isUploading ? 'Adding your picture…' : 'Hold to add a note'}</div>
					<span>long-press anywhere to get started</span>
				</div>
			{/if}
		</div>
	</div>

	<!-- Context menu -->
	{#if contextMenu.visible}
		<div class="context-backdrop" role="presentation"
			on:click={closeContextMenu}
			on:keydown={(e) => e.key === 'Escape' && closeContextMenu()}></div>
		<div class="context-menu"
			style="--mx: {contextMenu.x}px; --my: {contextMenu.y}px"
			role="menu" aria-label="Add to canvas">
			<button type="button" class="context-opt" role="menuitem" on:click={addTextAtMenu}>
				<span class="context-icon">✏️</span>
				<span>Add Note</span>
			</button>
			<button type="button" class="context-opt" role="menuitem" on:click={addPhotoAtMenu}>
				<span class="context-icon">📷</span>
				<span>Add Photo</span>
			</button>
		</div>
	{/if}

	<!-- Toolbar -->
	<div class="canvas-toolbar" aria-label="Canvas tools">
		<div class="toolbar-row">
			<button type="button" class="tool-btn" aria-label="Add photo" title="Add photo" on:click={openFilePicker}>📷</button>

			<div class="divider" aria-hidden="true"></div>

			<div class="color-palette" aria-label="Text color">
				{#each textColors as color}
					<button type="button" class="color-swatch" class:active={activeTextColor === color.value}
						style="--swatch: {color.value}" aria-label="{color.label} text" title="{color.label}"
						on:click={() => applyTextColor(color.value)}>
						<span class="sr-only">{color.label}</span>
					</button>
				{/each}
			</div>

			<div class="divider" aria-hidden="true"></div>

			<div class="size-picker" aria-label="Text size">
				{#each fontSizes as size}
					<button type="button" class="size-btn" class:active={activeTextSize === size}
						aria-label="Size {size}" title="Size {size}"
						on:click={() => applyTextSize(size)}>
						<span style="font-size: {Math.max(10, size * 0.55)}px">A</span>
					</button>
				{/each}
			</div>
		</div>

		<div class="toolbar-row font-row">
			{#each fontFamilies as font}
				<button type="button" class="font-btn" class:active={activeFont === font.value}
					style="font-family: {font.value}"
					aria-label="{font.label} font" title="{font.label}"
					on:click={() => applyTextFont(font.value)}>
					{font.label}
				</button>
			{/each}
		</div>
	</div>

	<input bind:this={fileInputEl} type="file" accept="image/*" multiple class="sr-only"
		on:change={handleFileInputChange} tabindex="-1" aria-hidden="true" />
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
		pointer-events: auto;
	}

	.canvas-board {
		position: relative;
		isolation: isolate;
		overflow: hidden;
		width: 100vw;
		height: 100svh;
		min-height: 100svh;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
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

	/* ── Items ── */
	.canvas-item {
		position: absolute;
		transform-origin: center;
		pointer-events: none;
	}

	.image-item {
		display: block;
		min-width: 4rem;
	}

	.image-item img {
		display: block;
		width: 100%;
		height: auto;
		border-radius: 1rem;
		box-shadow: 0 18px 42px rgba(93, 32, 62, 0.2);
		user-select: none;
		-webkit-user-drag: none;
	}

	.image-item.load-failed {
		display: grid;
		place-items: center;
		aspect-ratio: 4 / 3;
		min-height: 4rem;
		padding: 0.65rem;
		border: 1px solid rgba(196, 47, 98, 0.28);
		border-radius: 1rem;
		color: #8c2d52;
		background: rgba(255, 255, 255, 0.78);
		box-shadow: 0 18px 42px rgba(93, 32, 62, 0.14);
		text-align: center;
	}

	.image-item.load-failed img { display: none; }

	.image-fallback {
		font-size: 0.74rem;
		font-weight: 900;
		line-height: 1.25;
	}

	.text-item { z-index: 3; }

	.text-display {
		font-size: var(--text-size, 24px);
		font-weight: 800;
		color: var(--text-color, #c2185b);
		font-family: var(--text-font, Georgia, serif);
		white-space: pre-wrap;
		word-break: break-word;
		max-width: 80vw;
		line-height: 1.25;
		cursor: grab;
		padding: 0.2em 0.3em;
		border-radius: 0.4em;
		border: 1.5px solid transparent;
		transition: border-color 120ms;
		filter: drop-shadow(0 2px 8px rgba(93, 32, 62, 0.18));
	}

	.text-item.selected .text-display {
		border-color: rgba(255, 95, 159, 0.4);
		background: rgba(255, 255, 255, 0.18);
	}

	.text-editor {
		font-size: var(--text-size, 24px);
		font-weight: 800;
		color: var(--text-color, #c2185b);
		font-family: var(--text-font, Georgia, serif);
		min-width: 8ch;
		max-width: 80vw;
		width: auto;
		line-height: 1.25;
		padding: 0.2em 0.3em;
		border: 1.5px solid rgba(255, 95, 159, 0.55);
		border-radius: 0.4em;
		background: rgba(255, 255, 255, 0.72);
		resize: none;
		overflow: hidden;
		outline: none;
		box-shadow: 0 0 0 3px rgba(255, 95, 159, 0.18);
		pointer-events: auto;
		touch-action: auto;
		user-select: text;
		-webkit-user-select: text;
	}

	/* ── Controls overlay ── */
	.controls-layer {
		position: absolute;
		inset: 0;
		z-index: 1000;
		pointer-events: none;
	}

	.item-controls {
		position: absolute;
		transform-origin: center;
		pointer-events: none;
	}

	.item-controls.selected {
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

	.text-measure {
		font-weight: 800;
		white-space: pre-wrap;
		word-break: break-word;
		max-width: 80vw;
		line-height: 1.25;
		padding: 0.2em 0.3em;
	}

	.drag-handle {
		position: absolute;
		inset: 0;
		z-index: 0;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		box-shadow: none;
		cursor: grab;
		touch-action: none;
		pointer-events: auto;
	}

	.drag-handle:active { cursor: grabbing; }

	.drag-handle:hover,
	.drag-handle:focus-visible,
	.item-controls.selected .drag-handle {
		outline: 3px solid rgba(255, 95, 159, 0.45);
		outline-offset: 4px;
	}

	.ctrl-btn {
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
		opacity: 0.88;
		pointer-events: auto;
		transition: transform 160ms ease, opacity 160ms ease;
	}

	.ctrl-btn:hover, .ctrl-btn:focus-visible {
		transform: scale(1.1);
		opacity: 1;
		outline: none;
	}

	.remove-btn { top: -0.9rem; right: -0.9rem; }
	.rotate-btn { left: -0.9rem; bottom: -0.9rem; cursor: grab; touch-action: none; }
	.resize-btn { right: -0.9rem; bottom: -0.9rem; cursor: nwse-resize; touch-action: none; }
	.edit-btn   { left: -0.9rem; top: -0.9rem; }

	/* ── Context menu ── */
	.context-backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: transparent;
		pointer-events: auto;
	}

	.context-menu {
		position: fixed;
		left: clamp(0.75rem, var(--mx, 50%), calc(100vw - 11rem));
		top: clamp(0.75rem, var(--my, 50%), calc(100svh - 9rem));
		z-index: 50;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.45rem;
		border: 1px solid rgba(255, 255, 255, 0.72);
		border-radius: 1.2rem;
		background: linear-gradient(145deg, rgba(255, 255, 255, 0.92), rgba(255, 226, 242, 0.94));
		box-shadow: 0 20px 48px rgba(120, 35, 80, 0.22), 0 2px 8px rgba(120, 35, 80, 0.1), inset 0 1px 0 #fff;
		backdrop-filter: blur(28px) saturate(1.5);
		pointer-events: auto;
		animation: menu-pop 180ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}

	@keyframes menu-pop {
		from { opacity: 0; transform: scale(0.88); }
		to   { opacity: 1; transform: scale(1); }
	}

	.context-opt {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.6rem 1rem;
		border: 0;
		border-radius: 0.8rem;
		font: inherit;
		font-size: 1rem;
		font-weight: 700;
		color: #5a1a35;
		background: transparent;
		cursor: pointer;
		transition: background 120ms ease, transform 120ms ease;
		white-space: nowrap;
		min-width: 9.5rem;
	}

	.context-opt:hover, .context-opt:focus-visible {
		background: rgba(255, 95, 159, 0.12);
		transform: translateX(2px);
		outline: none;
	}

	.context-icon {
		font-size: 1.3rem;
		line-height: 1;
	}

	/* ── Empty state ── */
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
		font-size: clamp(1.8rem, 7vw, 4.5rem);
		font-weight: 900;
		letter-spacing: -0.06em;
	}

	.empty-state span {
		font-weight: 800;
		letter-spacing: 0.02em;
	}

	/* ── Toolbar ── */
	.canvas-toolbar {
		position: fixed;
		left: 50%;
		bottom: calc(max(1rem, env(safe-area-inset-bottom)) + 5.5rem);
		z-index: 30;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid rgba(255, 255, 255, 0.68);
		border-radius: 1.4rem;
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.72), rgba(255, 226, 240, 0.82));
		box-shadow: 0 12px 28px rgba(150, 44, 92, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(22px) saturate(1.4);
		pointer-events: auto;
		transform: translateX(-50%);
	}

	.toolbar-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.tool-btn {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border: 0;
		border-radius: 999px;
		font: inherit;
		font-size: 1rem;
		color: #6b2842;
		background: rgba(255, 255, 255, 0.92);
		box-shadow: 0 4px 10px rgba(160, 50, 100, 0.12), inset 0 1px 0 #fff;
		cursor: pointer;
		transition: transform 160ms ease, box-shadow 160ms ease;
	}

	.tool-btn:hover, .tool-btn:focus-visible {
		transform: translateY(-1px);
		box-shadow: 0 8px 18px rgba(160, 50, 100, 0.2), inset 0 1px 0 #fff;
		outline: none;
	}

	.divider {
		width: 1px;
		height: 1.4rem;
		background: rgba(142, 63, 99, 0.16);
		margin: 0 0.1rem;
	}

	.color-palette {
		display: flex;
		align-items: center;
		gap: 0.22rem;
	}

	.color-swatch {
		display: block;
		width: 1.15rem;
		height: 1.15rem;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background-color: var(--swatch);
		background-image: linear-gradient(145deg, rgba(255,255,255,0.3), transparent 55%);
		box-shadow: inset 0 0 0 1.5px rgba(255,255,255,0.9), 0 4px 8px rgba(115,37,78,0.12);
		cursor: pointer;
		transition: transform 140ms ease;
	}

	.color-swatch:hover { transform: scale(1.15); }

	.color-swatch.active {
		outline: 2px solid #fff;
		outline-offset: 1.5px;
		box-shadow: 0 0 0 3.5px rgba(255, 95, 159, 0.4), 0 4px 10px rgba(115,37,78,0.14);
	}

	.size-picker {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}

	.size-btn {
		display: grid;
		place-items: center;
		width: 1.7rem;
		height: 1.7rem;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.88);
		box-shadow: 0 3px 8px rgba(160, 50, 100, 0.1), inset 0 1px 0 #fff;
		cursor: pointer;
		transition: transform 140ms ease, background 140ms ease;
		color: #6b2842;
		font-family: Georgia, serif;
		font-weight: 700;
	}

	.size-btn:hover { transform: scale(1.08); }

	.size-btn.active {
		background: linear-gradient(135deg, #ff5f9f, #9d6bff);
		color: #fff;
		box-shadow: 0 6px 16px rgba(111, 39, 78, 0.22), inset 0 1px 0 rgba(255,255,255,0.4);
	}

	/* ── Font row ── */
	.font-row {
		gap: 0.2rem;
		padding-top: 0.1rem;
		border-top: 1px solid rgba(142, 63, 99, 0.1);
		width: 100%;
		justify-content: center;
	}

	.font-btn {
		display: grid;
		place-items: center;
		padding: 0.18rem 0.55rem;
		border: 1.5px solid transparent;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 700;
		color: #6b2842;
		background: rgba(255, 255, 255, 0.82);
		box-shadow: 0 2px 6px rgba(160, 50, 100, 0.08), inset 0 1px 0 #fff;
		cursor: pointer;
		transition: transform 130ms ease, background 130ms ease;
		white-space: nowrap;
	}

	.font-btn:hover { transform: scale(1.06); }

	.font-btn.active {
		background: linear-gradient(135deg, #ff5f9f, #9d6bff);
		color: #fff;
		box-shadow: 0 5px 14px rgba(111, 39, 78, 0.22), inset 0 1px 0 rgba(255,255,255,0.35);
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

	@media (max-width: 520px) {
		.canvas-toolbar {
			gap: 0.28rem;
			padding: 0.32rem 0.44rem;
		}

		.color-swatch {
			width: 1rem;
			height: 1rem;
		}

		.size-btn {
			width: 1.45rem;
			height: 1.45rem;
		}

		.font-btn {
			font-size: 0.7rem;
			padding: 0.15rem 0.42rem;
		}
	}
</style>
