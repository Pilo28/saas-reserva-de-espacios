-- Piso y depto del vecino: se apoya en la tabla "units" que ya existia desde la Fase 3
-- (nunca tuvo UI hasta ahora). "label" ya existia como el identificador del depto (ej. "A",
-- "302"); se agrega "floor" para separar el piso. La unicidad pasa a incluir el piso, para
-- que "depto A" del piso 1 y el piso 3 no choquen entre si.
alter table public.units add column floor text;

alter table public.units drop constraint units_building_id_label_key;
alter table public.units add constraint units_building_id_floor_label_key unique (building_id, floor, label);

-- La invitacion tambien carga la unidad elegida, para que quede asignada de una al aceptar.
alter table public.building_invitations add column unit_id uuid references public.units (id) on delete set null;

-- accept_pending_invitations ahora copia el unit_id de la invitacion al crear la membresia.
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
    insert into public.building_members (building_id, user_id, unit_id, role)
    values (inv.building_id, auth.uid(), inv.unit_id, inv.role)
    on conflict (building_id, user_id) do nothing;

    update public.building_invitations
    set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
    where id = inv.id;
  end loop;
end;
$$;
