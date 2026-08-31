-- El corazon del producto: reservas, con el anti-doble-reserva garantizado por la base
-- de datos (no por la app) via exclusion constraint sobre rango de tiempo.

create type public.reservation_status as enum ('confirmed', 'cancelled');

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  unit_id uuid references public.units (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.reservation_status not null default 'confirmed',
  guests_count int check (guests_count is null or guests_count > 0),
  notes text,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index reservations_space_id_idx on public.reservations (space_id, starts_at);
create index reservations_building_id_idx on public.reservations (building_id);
create index reservations_user_id_idx on public.reservations (user_id);

-- btree_gist permite usar "=" sobre space_id (un uuid) dentro de un indice GiST, que es
-- lo que necesita el exclusion constraint para combinar igualdad + solapamiento de rango.
create extension if not exists btree_gist;

-- El mecanismo central: dos reservas del mismo espacio con rangos [starts_at, ends_at)
-- que se solapan no pueden coexistir mientras ambas esten "confirmed". Esto lo aplica
-- Postgres a nivel de constraint, en la misma transaccion del insert: gana quien
-- confirma primero en el motor, sin importar el orden de llegada al frontend, y
-- funciona igual aunque dos usuarios inserten en el mismo instante.
alter table public.reservations
  add constraint reservations_no_overlap
  exclude using gist (
    space_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status = 'confirmed');

alter table public.reservations enable row level security;

create trigger reservations_set_updated_at
  before update on public.reservations
  for each row
  execute function public.set_updated_at();

-- La fila completa (notas, cantidad de invitados, quien reservo) solo la ve el dueno
-- de la reserva o el admin del edificio.
create policy "reservations_select_own_or_admin"
  on public.reservations for select
  using (user_id = auth.uid() or public.is_admin_of(building_id));

-- Un vecino reserva para si mismo; un admin puede reservar en nombre de cualquier
-- miembro del edificio (alta manual, seccion 6/10 del brief original).
create policy "reservations_insert_self_or_admin"
  on public.reservations for insert
  with check (
    (user_id = auth.uid() and public.is_member_of(building_id))
    or public.is_admin_of(building_id)
  );

-- Update (usado para cancelar: status='cancelled', cancelled_at, cancelled_by) permitido
-- al dueno o al admin. No hay policy de delete: las reservas nunca se borran, queda
-- auditoria completa.
create policy "reservations_update_own_or_admin"
  on public.reservations for update
  using (user_id = auth.uid() or public.is_admin_of(building_id));

-- Vista de solo disponibilidad: cualquier miembro del edificio puede ver que un horario
-- esta ocupado, sin ver de quien es la reserva ni sus notas/invitados. Al no llevar
-- security_invoker, corre con los privilegios del dueno de la vista (bypassea la RLS de
-- "reservations", que solo deja ver la fila propia) — por eso el propio "where" de la
-- vista tiene que reimplementar el filtro de aislamiento (is_member_of) a mano.
-- security_barrier evita que el planner reordene un filtro externo antes que este check.
create view public.reservation_slots
with (security_barrier = true)
as
select id, building_id, space_id, starts_at, ends_at, status
from public.reservations
where status = 'confirmed'
  and public.is_member_of(building_id);

grant select on public.reservation_slots to authenticated;
