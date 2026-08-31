-- Multi-tenancy core: buildings, units, building_members (la membresia es lo que define
-- el limite de tenant), y platform_admins para el super admin de la plataforma.

create type public.building_role as enum ('admin', 'resident');

create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  settings jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index buildings_created_by_idx on public.buildings (created_by);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now(),
  unique (building_id, label)
);

-- La membresia es la fuente de verdad de a que edificio pertenece un usuario y con que
-- rol. building_id se repite tal cual en las tablas que dependen de esta (reservations,
-- etc.) para que las policies de RLS sean una comparacion directa, no un join.
create table public.building_members (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  unit_id uuid references public.units (id) on delete set null,
  role public.building_role not null default 'resident',
  created_at timestamptz not null default now(),
  unique (building_id, user_id)
);

create index building_members_user_id_idx on public.building_members (user_id);

-- Separada de building_members a proposito: un bug de rol en building_members nunca
-- deberia poder dar acceso de "admin de edificio" sobre todos los edificios a la vez.
create table public.platform_admins (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.buildings enable row level security;
alter table public.units enable row level security;
alter table public.building_members enable row level security;
alter table public.platform_admins enable row level security;
-- platform_admins no tiene ninguna policy: queda inaccesible para los roles anon/authenticated,
-- solo se lee via funciones security definer o con la connection string directa.

-- Los tres helpers de abajo consultan siempre "where user_id = auth.uid()" primero, por lo
-- que la policy de building_members (select propio OR is_admin_of) nunca necesita evaluar
-- is_admin_of para resolver la propia fila del usuario: no hay recursion infinita posible.

create function public.is_member_of(target_building_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.building_members
    where building_id = target_building_id
      and user_id = auth.uid()
  );
$$;

create function public.is_admin_of(target_building_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.building_members
    where building_id = target_building_id
      and user_id = auth.uid()
      and role = 'admin'
  );
$$;

-- security definer: platform_admins no tiene policies, asi que sin esto la funcion no
-- podria leer ni siquiera la fila del propio usuario.
create function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins
    where id = auth.uid()
  );
$$;

create trigger buildings_set_updated_at
  before update on public.buildings
  for each row
  execute function public.set_updated_at();

-- Alta self-service: quien crea el edificio queda como admin automaticamente. Security
-- definer es obligatorio aca: en el momento del insert el usuario todavia no es miembro
-- de nada, asi que la policy de insert de building_members (is_admin_of) lo rechazaria.
create function public.handle_new_building()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.building_members (building_id, user_id, role)
  values (new.id, new.created_by, 'admin');
  return new;
end;
$$;

create trigger on_building_created
  after insert on public.buildings
  for each row
  execute function public.handle_new_building();

create policy "buildings_select_members"
  on public.buildings for select
  using (public.is_member_of(id) or public.is_platform_admin());

create policy "buildings_insert_self"
  on public.buildings for insert
  with check (created_by = auth.uid());

create policy "buildings_update_admins"
  on public.buildings for update
  using (public.is_admin_of(id) or public.is_platform_admin());

create policy "units_select_members"
  on public.units for select
  using (public.is_member_of(building_id));

create policy "units_insert_admins"
  on public.units for insert
  with check (public.is_admin_of(building_id));

create policy "units_update_admins"
  on public.units for update
  using (public.is_admin_of(building_id));

create policy "units_delete_admins"
  on public.units for delete
  using (public.is_admin_of(building_id));

create policy "building_members_select_own_or_admin"
  on public.building_members for select
  using (auth.uid() = user_id or public.is_admin_of(building_id));

create policy "building_members_insert_admin"
  on public.building_members for insert
  with check (public.is_admin_of(building_id));

create policy "building_members_update_admin"
  on public.building_members for update
  using (public.is_admin_of(building_id));

create policy "building_members_delete_admin"
  on public.building_members for delete
  using (public.is_admin_of(building_id));
