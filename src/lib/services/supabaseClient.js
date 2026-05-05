import { env } from '$env/dynamic/public';
import { createClient } from '@supabase/supabase-js';

function normalizeSupabaseUrl(url) {
	return (url ?? '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

function normalizeUsernameDomain(domain) {
	return (domain ?? 'canvas.local').trim().replace(/^@+/, '').toLowerCase() || 'canvas.local';
}

function normalizeAuthValue(value) {
	return (value ?? '').trim().toLowerCase();
}

const SUPABASE_URL = normalizeSupabaseUrl(env.PUBLIC_SUPABASE_URL);
const SUPABASE_ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY;
const AUTH_USERNAME = normalizeAuthValue(env.PUBLIC_SUPABASE_AUTH_USERNAME);
const AUTH_EMAIL = normalizeAuthValue(env.PUBLIC_SUPABASE_AUTH_EMAIL);

export const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const authUsernameDomain = normalizeUsernameDomain(env.PUBLIC_SUPABASE_USERNAME_DOMAIN);
export const canvasStorageBucket = 'canvas-uploads';
export const canvasTableName = 'canvas_state';
export const canvasRowId = 'forever-canvas';

const localStorageKey = 'alejandra-forever-canvas-v1';
const signedUrlTtlSeconds = 60 * 60 * 24 * 7;

export const supabase = hasSupabaseConfig
	? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
			auth: {
				autoRefreshToken: true,
				detectSessionInUrl: true,
				persistSession: true
			}
		})
	: null;

export const defaultCanvasState = {
	version: 1,
	items: [],
	strokes: [],
	updatedAt: null
};

function isBrowser() {
	return typeof window !== 'undefined';
}

function makeId(prefix) {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return `${prefix}-${crypto.randomUUID()}`;
	}

	return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeCanvasState(state) {
	return {
		...defaultCanvasState,
		...(state ?? {}),
		items: Array.isArray(state?.items) ? state.items : [],
		strokes: Array.isArray(state?.strokes) ? state.strokes : []
	};
}

export function loadLocalCanvasState() {
	if (!isBrowser()) return defaultCanvasState;

	try {
		const saved = window.localStorage.getItem(localStorageKey);
		return saved ? normalizeCanvasState(JSON.parse(saved)) : defaultCanvasState;
	} catch (error) {
		console.warn('Unable to read local canvas state', error);
		return defaultCanvasState;
	}
}

export function saveLocalCanvasState(state) {
	const cleanState = normalizeCanvasState({
		...state,
		updatedAt: state?.updatedAt ?? new Date().toISOString()
	});

	if (isBrowser()) {
		window.localStorage.setItem(localStorageKey, JSON.stringify(cleanState));
	}

	return cleanState;
}

async function updateRemoteCanvasState(cleanState) {
	const { data, error } = await supabase
		.from(canvasTableName)
		.update({
			state: cleanState,
			updated_at: cleanState.updatedAt
		})
		.eq('id', canvasRowId)
		.select('id');

	if (error) {
		throw error;
	}

	return Boolean(data?.length);
}

export async function loadCanvasState() {
	if (!supabase) {
		return loadLocalCanvasState();
	}

	const { data, error } = await supabase
		.from(canvasTableName)
		.select('state')
		.eq('id', canvasRowId)
		.maybeSingle();

	if (error) {
		throw error;
	}

	return data?.state ? normalizeCanvasState(data.state) : loadLocalCanvasState();
}

export async function saveCanvasState(state, options = {}) {
	const { remote = true } = options;
	const cleanState = saveLocalCanvasState({
		...state,
		updatedAt: new Date().toISOString()
	});

	if (!supabase || !remote) {
		return { target: 'local', state: cleanState };
	}

	const row = {
		id: canvasRowId,
		state: cleanState,
		updated_at: cleanState.updatedAt
	};

	const updated = await updateRemoteCanvasState(cleanState);

	if (!updated) {
		const { error } = await supabase.from(canvasTableName).insert(row);

		if (error?.code === '23505') {
			const retryUpdated = await updateRemoteCanvasState(cleanState);

			if (!retryUpdated) {
				throw new Error('Canvas state exists, but this signed-in user cannot update it.');
			}
		} else if (error) {
			throw error;
		}
	}

	return { target: 'supabase', state: cleanState };
}

export async function getSession() {
	if (!supabase) return null;

	const { data, error } = await supabase.auth.getSession();
	if (error) throw error;
	return data.session;
}

export function onAuthChange(callback) {
	if (!supabase) return () => {};

	const { data } = supabase.auth.onAuthStateChange((_event, session) => {
		callback(session);
	});

	return () => data.subscription.unsubscribe();
}

function usernameToAuthEmail(username) {
	const value = username.trim().toLowerCase();
	if (value.includes('@')) return value;
	if (AUTH_USERNAME && AUTH_EMAIL && value === AUTH_USERNAME) return AUTH_EMAIL;

	const safeUsername = value
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '');

	if (!safeUsername) {
		throw new Error('Enter a username.');
	}

	return `${safeUsername}@${authUsernameDomain}`;
}

export function authEmailToUsername(email) {
	const value = normalizeAuthValue(email);
	if (AUTH_USERNAME && AUTH_EMAIL && value === AUTH_EMAIL) return AUTH_USERNAME;

	const suffix = `@${authUsernameDomain}`;
	return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

export async function signInWithPassword(username, password) {
	if (!supabase) {
		throw new Error('Supabase is not configured yet.');
	}

	return supabase.auth.signInWithPassword({
		email: usernameToAuthEmail(username),
		password
	});
}

export async function signOut() {
	if (!supabase) return;
	const { error } = await supabase.auth.signOut();
	if (error) throw error;
}

export function fileToDataUrl(file) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

function cleanFilename(name) {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'canvas-image';
}

function getCanvasStoragePath(src) {
	const marker = `/storage/v1/object/public/${canvasStorageBucket}/`;
	const value = String(src ?? '');
	const markerIndex = value.indexOf(marker);

	if (markerIndex === -1) {
		return null;
	}

	try {
		const url = new URL(value);
		return decodeURIComponent(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));
	} catch {
		return decodeURIComponent(value.slice(markerIndex + marker.length).split(/[?#]/)[0]);
	}
}

export async function getCanvasImageDisplayUrl(src) {
	if (!supabase) {
		return src;
	}

	const path = getCanvasStoragePath(src);

	if (!path) {
		return src;
	}

	const { data, error } = await supabase.storage
		.from(canvasStorageBucket)
		.createSignedUrl(path, signedUrlTtlSeconds);

	if (error) {
		throw error;
	}

	return data.signedUrl;
}

export async function uploadCanvasImage(file, options = {}) {
	const { remote = true } = options;

	if (!supabase || !remote) {
		return fileToDataUrl(file);
	}

	const dateFolder = new Date().toISOString().slice(0, 10);
	const path = `${dateFolder}/${makeId('image')}-${cleanFilename(file.name)}`;
	const { error } = await supabase.storage.from(canvasStorageBucket).upload(path, file, {
		cacheControl: '31536000',
		upsert: false
	});

	if (error) {
		throw error;
	}

	const { data } = supabase.storage.from(canvasStorageBucket).getPublicUrl(path);
	return data.publicUrl;
}
