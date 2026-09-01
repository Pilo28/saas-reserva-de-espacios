-- Alta de vecinos por invitacion (sin email real): el admin carga el mail de la persona.
-- Si ya tiene cuenta, se une al toque via accept_pending_invitations(). Si todavia no se
-- registro, la invitacion queda "pending" y se resuelve sola la proxima vez que esa persona
-- inicie sesion con ese mail (se llama desde el frontend al entrar a Home, mismo criterio
-- que generate_reservation_reminders en la Fase 9). El aviso "te invitaron" se lo da el
-- admin por fuera de la app (WhatsApp, como hace hoy), no hay email saliente.

create type public.invitation_status as enum ('pending', 'accepted', 'cancelled');

create table public.building_invitations (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings (id) on delete cascade,
  email text not null,
  role public.building_role not null default 'resident',
  status public.invitation_status not null default 'pending',
  invited_by uuid not null references auth.users (id),
  accepted_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index building_invitations_building_id_idx on public.building_invitations (building_id);

-- Solo una invitacion pendiente a la vez por mail+edificio (evita duplicados mientras
-- alguien no se registra). No es un unique constraint de la tabla porque una vez aceptada
-- o cancelada, esa misma persona podria ser reinvitada mas adelante.
create unique index building_invitations_pending_unique
  on public.building_invitations (building_id, lower(email))
  where status = 'pending';

alter table public.building_invitations enable row level security;

create policy "building_invitations_select_admin_or_invitee"
  on public.building_invitations for select
  using (public.is_admin_of(building_id) or lower(email) = lower(auth.email()));

create policy "building_invitations_insert_admin"
  on public.building_invitations for insert
  with check (public.is_admin_of(building_id) and invited_by = auth.uid());

-- Update es solo para que el admin cancele una invitacion pendiente (status -> cancelled).
-- La aceptacion NO pasa por aca: la hace accept_pending_invitations(), security definer,
-- para poder tambien insertar en building_members en la misma operacion.
create policy "building_invitations_update_admin"
  on public.building_invitations for update
  using (public.is_admin_of(building_id))
  with check (public.is_admin_of(building_id));

create or replace function public.accept_pending_invitations()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  for inv in
    select * from public.building_invitations
    where status = 'pending' and lower(email) = lower(auth.email())
  loop
    insert into public.building_members (building_id, user_id, role)
    values (inv.building_id, auth.uid(), inv.role)
    on conflict (building_id, user_id) do nothing;

    update public.building_invitations
    set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
    where id = inv.id;
  end loop;
end;
$$;

grant execute on function public.accept_pending_invitations() to authenticated;

-- Ampliacion de privacidad (a pedido del usuario, revierte parte de la Fase 6/8): antes
-- solo el admin veia el nombre de sus vecinos. Ahora cualquier miembro de un edificio ve el
-- nombre de cualquier otro miembro del MISMO edificio -- lo necesita reservation_slots de
-- abajo para mostrar quien ocupa un horario. Sigue sin ver nada de miembros de otro edificio.
drop policy "profiles_select_admin_of_shared_building" on public.profiles;

create policy "profiles_select_shared_building_member"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.building_members bm
      where bm.user_id = profiles.id
        and public.is_member_of(bm.building_id)
    )
  );

-- reservation_slots ahora expone tambien user_id: el vecino que consulta disponibilidad
-- puede ver QUIEN ocupa un horario (no solo que esta ocupado), para no tener que
-- preguntarle al admin. Notes/guests_count de la reserva siguen sin exponerse aca.
-- user_id va al final: "create or replace view" no permite insertar una columna en el
-- medio de una vista existente, solo agregar al final (o habria que hacer drop+create).
create or replace view public.reservation_slots
with (security_barrier = true)
as
select id, building_id, space_id, starts_at, ends_at, status, user_id
from public.reservations
where status = 'confirmed'
  and public.is_member_of(building_id);
