# aniketlovesalejandra.github.io

A tiny romantic SvelteKit site for Alejandra with:

- a live date at the top
- a blank canvas for dropped images, stickers, and pencil drawings
- a bottom Apple-dock-style navigation bar
- a cake view with a letter, Spotify embed, and five Pinterest-style photo pins

## Local development

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env` and fill in Supabase keys when permanent saving is ready.

## Supabase setup for permanent canvas saves

Create a public storage bucket named `canvas-uploads`.

Create this table:

```sql
create table if not exists public.canvas_state (
	id text primary key,
	state jsonb not null default '{}'::jsonb,
	updated_at timestamptz not null default now()
);
```

Enable row level security and replace the emails below with the two allowed emails:

```sql
alter table public.canvas_state enable row level security;

create policy "Canvas state is readable"
on public.canvas_state for select
using (true);

create policy "Only allowed lovers can save canvas state"
on public.canvas_state for insert
with check (auth.email() in ('you@example.com', 'alejandra@example.com'));

create policy "Only allowed lovers can update canvas state"
on public.canvas_state for update
using (auth.email() in ('you@example.com', 'alejandra@example.com'))
with check (auth.email() in ('you@example.com', 'alejandra@example.com'));
```

For storage, allow public reads and authenticated uploads only for the same emails:

```sql
create policy "Canvas uploads are readable"
on storage.objects for select
using (bucket_id = 'canvas-uploads');

create policy "Only allowed lovers can upload canvas images"
on storage.objects for insert
with check (
	bucket_id = 'canvas-uploads'
	and auth.email() in ('you@example.com', 'alejandra@example.com')
);
```

If Supabase keys are missing, the app still works in local demo mode using browser storage.

## Build

```sh
npm run build
```
