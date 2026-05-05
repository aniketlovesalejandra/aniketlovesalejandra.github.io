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

Copy `.env.example` to `.env` and fill in Supabase keys when permanent saving is ready. `PUBLIC_SUPABASE_URL` should be the project URL, like `https://project-ref.supabase.co`, not the `/rest/v1/` endpoint. For the private canvas login, `PUBLIC_SUPABASE_AUTH_USERNAME=aniketlovesalejandra` maps to `PUBLIC_SUPABASE_AUTH_EMAIL=ianiket23@gmail.com`. For a static deployment, make sure those `PUBLIC_` variables are set before running `npm run build`; otherwise the built site falls back to browser-only storage.

## Supabase setup for permanent canvas saves

The canvas sign-in uses one username and password. Supabase Auth signs in with an email behind the scenes, so the app maps this username:

- username: `aniketlovesalejandra`
- Supabase Auth email: `ianiket23@gmail.com`

In Supabase:

1. Go to **Authentication → Providers → Email**.
2. Enable the Email provider and password sign-ins.
3. Go to **Authentication → Users**.
4. Add one user with email `ianiket23@gmail.com`.
5. Set that user's password.
6. Confirm the user manually, or disable email confirmation while creating the user.

Create a public storage bucket named `canvas-uploads`. If you already created it and uploads save but images do not display, make sure the bucket itself is public; a read policy alone does not make `getPublicUrl()` images render in the browser.

```sql
update storage.buckets
set public = true
where id = 'canvas-uploads';

select id, name, public
from storage.buckets
where id = 'canvas-uploads';
```

Create this table:

```sql
create table if not exists public.canvas_state (
	id text primary key,
	state jsonb not null default '{}'::jsonb,
	updated_at timestamptz not null default now()
);

alter table public.canvas_state
add column if not exists state jsonb not null default '{}'::jsonb;

alter table public.canvas_state
add column if not exists updated_at timestamptz not null default now();
```

Find the Auth user id for the email that signs in:

```sql
select id, email, email_confirmed_at
from auth.users
where lower(email) = lower('ianiket23@gmail.com');
```

Enable row level security for that one user. Replace `PASTE_AUTH_USER_ID_HERE` with the `id` returned above:

```sql
alter table public.canvas_state enable row level security;

insert into public.canvas_state (id, state)
values ('forever-canvas', '{}'::jsonb)
on conflict (id) do nothing;

drop policy if exists "Canvas state is readable" on public.canvas_state;
drop policy if exists "Only allowed lovers can save canvas state" on public.canvas_state;
drop policy if exists "Only allowed lovers can update canvas state" on public.canvas_state;

create policy "Canvas state is readable"
on public.canvas_state for select
using (true);

create policy "Only allowed lovers can save canvas state"
on public.canvas_state for insert
to authenticated
with check (auth.uid() = 'PASTE_AUTH_USER_ID_HERE'::uuid);

create policy "Only allowed lovers can update canvas state"
on public.canvas_state for update
to authenticated
using (auth.uid() = 'PASTE_AUTH_USER_ID_HERE'::uuid)
with check (auth.uid() = 'PASTE_AUTH_USER_ID_HERE'::uuid);
```

For storage, allow public reads and authenticated uploads only for the same user:

```sql
drop policy if exists "Canvas uploads are readable" on storage.objects;
drop policy if exists "Only allowed lovers can upload canvas images" on storage.objects;

create policy "Canvas uploads are readable"
on storage.objects for select
using (bucket_id = 'canvas-uploads');

create policy "Only allowed lovers can upload canvas images"
on storage.objects for insert
to authenticated
with check (
	bucket_id = 'canvas-uploads'
	and auth.uid() = 'PASTE_AUTH_USER_ID_HERE'::uuid
);
```

If signing in works but saving says `new row violates row-level security policy`, the policy user id does not match the Auth user that signed in, or the deployed app was built without the intended `PUBLIC_SUPABASE_AUTH_EMAIL` value. Re-run the `auth.users` query, update the policy id, and rebuild/redeploy after setting the `PUBLIC_` variables.

If uploads appear in the `canvas-uploads` bucket but the canvas shows `Image saved, URL blocked`, the bucket is private or the public object URL is not readable. Run the storage bucket SQL above, then reload the site.

If Supabase keys are missing, the app still works in local demo mode using browser storage.

After deploying, sign in from the canvas with username `aniketlovesalejandra` and the password you set for `ianiket23@gmail.com` so new drawings and uploads can save permanently.

## Build

```sh
npm run build
```
