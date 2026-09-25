-- KRISHI SETU — farmer profile storage
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
