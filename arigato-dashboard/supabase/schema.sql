-- KRISHI SETU — Supabase schema: farmer accounts, profiles and activity
-- Run once in Supabase Dashboard → SQL Editor for project vcuaftykxkpingyvaktl.

create table if not exists public.farmer_profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text,
  location            jsonb,          -- { lat, lon, name, district, state, source, presetId }
  plot_size           numeric check (plot_size >= 0),
  plot_unit           text check (plot_unit in ('acre', 'sqft', 'guntha', 'hectare')),
  primary_crop        text,
  irrigation          text check (irrigation in ('available', 'partial', 'none')),
  farming_type        text,
  minor_share_percent integer check (minor_share_percent between 0 and 100),
  compare_list        text[] default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.farmer_profiles enable row level security;

-- Each farmer can only see and change their own profile
create policy "Farmers read own profile"
  on public.farmer_profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Farmers insert own profile"
  on public.farmer_profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Farmers update own profile"
  on public.farmer_profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- Farmer activity log — what each signed-in farmer did in the dashboard
-- (hardware sensor data lives in MongoDB, not here)
-- ---------------------------------------------------------------------------
create table if not exists public.user_activity (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event       text not null check (char_length(event) <= 64),
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists user_activity_user_time_idx
  on public.user_activity (user_id, created_at desc);

alter table public.user_activity enable row level security;

create policy "Farmers read own activity"
  on public.user_activity for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Farmers log own activity"
  on public.user_activity for insert
  to authenticated
  with check ((select auth.uid()) = user_id);
