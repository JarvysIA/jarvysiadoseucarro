
-- Enum for roles
create type public.app_role as enum ('admin', 'user');

-- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  whatsapp text not null,
  email text,
  placa text,
  status_usuario text not null default 'trial' check (status_usuario in ('trial','ativo')),
  permite_indicacao boolean not null default false,
  trial_inicio timestamptz not null default now(),
  created_at timestamptz not null default now()
);

grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;

alter table public.profiles enable row level security;

-- veiculos
create table public.veiculos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  placa text not null,
  marca text,
  modelo text,
  ano text,
  motorizacao text,
  km_atual integer,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.veiculos to authenticated;
grant all on public.veiculos to service_role;

alter table public.veiculos enable row level security;

-- user_roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

-- has_role function (security definer)
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- RLS profiles
create policy "Users can view own profile"
on public.profiles for select to authenticated
using (auth.uid() = id);

create policy "Users can insert own profile"
on public.profiles for insert to authenticated
with check (auth.uid() = id);

create policy "Users can update own profile"
on public.profiles for update to authenticated
using (auth.uid() = id);

create policy "Admins can view all profiles"
on public.profiles for select to authenticated
using (public.has_role(auth.uid(), 'admin'));

create policy "Admins can update all profiles"
on public.profiles for update to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- RLS veiculos
create policy "Users can view own veiculos"
on public.veiculos for select to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own veiculos"
on public.veiculos for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own veiculos"
on public.veiculos for update to authenticated
using (auth.uid() = user_id);

create policy "Users can delete own veiculos"
on public.veiculos for delete to authenticated
using (auth.uid() = user_id);

create policy "Admins can view all veiculos"
on public.veiculos for select to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- RLS user_roles
create policy "Users can view own roles"
on public.user_roles for select to authenticated
using (auth.uid() = user_id);

create policy "Admins can view all roles"
on public.user_roles for select to authenticated
using (public.has_role(auth.uid(), 'admin'));
