-- Espacios comunes reservables, sus ventanas horarias de disponibilidad, y bloqueos
-- manuales del admin (mantenimiento, feriados). building_id se repite en las tres tablas
-- a proposito (mismo criterio que building_members/units): las policies de RLS quedan
-- una comparacion directa, sin joins.

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  name text not null,
  description text,
  capacity int check (capacity is null or capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index spaces_building_id_idx on public.spaces (building_id);

-- weekday: 0 = domingo .. 6 = sabado, igual que Date.getDay() en JS y extract(dow from ...)
-- en Postgres, para no necesitar ninguna conversion entre frontend y base.
create table public.space_schedules (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  space_id uuid not null references public.spaces (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  created_at timestamptz not null default now(),
  check (opens_at < closes_at)
);

create index space_schedules_space_id_idx on public.space_schedules (space_id);
create index space_schedules_building_id_idx on public.space_schedules (building_id);

create table public.blocked_periods (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  space_id uuid references public.spaces (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index blocked_periods_space_id_idx on public.blocked_periods (space_id, starts_at);
create index blocked_periods_building_id_idx on public.blocked_periods (building_id);

alter table public.spaces enable row level security;
alter table public.space_schedules enable row level security;
alter table public.blocked_periods enable row level security;

create trigger spaces_set_updated_at
  before update on public.spaces
  for each row
  execute function public.set_updated_at();

create policy "spaces_select_members"
  on public.spaces for select
  using (public.is_member_of(building_id));

create policy "spaces_insert_admins"
  on public.spaces for insert
  with check (public.is_admin_of(building_id));

create policy "spaces_update_admins"
  on public.spaces for update
  using (public.is_admin_of(building_id));

create policy "spaces_delete_admins"
  on public.spaces for delete
  using (public.is_admin_of(building_id));

create policy "space_schedules_select_members"
  on public.space_schedules for select
  using (public.is_member_of(building_id));

create policy "space_schedules_insert_admins"
  on public.space_schedules for insert
  with check (public.is_admin_of(building_id));

create policy "space_schedules_update_admins"
  on public.space_schedules for update
  using (public.is_admin_of(building_id));

create policy "space_schedules_delete_admins"
  on public.space_schedules for delete
  using (public.is_admin_of(building_id));

create policy "blocked_periods_select_members"
  on public.blocked_periods for select
  using (public.is_member_of(building_id));

create policy "blocked_periods_insert_admins"
  on public.blocked_periods for insert
  with check (public.is_admin_of(building_id));

create policy "blocked_periods_update_admins"
  on public.blocked_periods for update
  using (public.is_admin_of(building_id));

create policy "blocked_periods_delete_admins"
  on public.blocked_periods for delete
  using (public.is_admin_of(building_id));
