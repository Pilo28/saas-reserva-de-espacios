-- Los horarios de disponibilidad (space_schedules) eran hasta ahora solo informativos: la
-- base no impedia reservar fuera de esas ventanas. Se detecto en vivo (reserva de jueves
-- 18-22 aceptada en un espacio configurado solo Viernes/Sabado 20-23). Se agrega
-- enforcement real, mismo criterio que enforce_reservation_rules (Fase 7): trigger antes
-- del insert, en la base, no solo en el frontend -- el admin del edificio queda exento.
--
-- Decision explicita del usuario: un espacio SIN ningun horario cargado queda BLOQUEADO
-- (no se puede reservar nada) hasta que el admin cargue al menos una ventana -- no es
-- "sin restriccion". Cada fila de space_schedules habilita un dia puntual; los dias sin
-- fila quedan automaticamente sin disponibilidad, sin necesidad de "deshabilitarlos".
create or replace function public.enforce_reservation_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bld_timezone text;
  local_starts timestamp;
  local_ends timestamp;
  starts_weekday smallint;
  matches boolean;
begin
  if public.is_admin_of(new.building_id) then
    return new;
  end if;

  select timezone into bld_timezone from public.buildings where id = new.building_id;

  local_starts := new.starts_at at time zone bld_timezone;
  local_ends := new.ends_at at time zone bld_timezone;

  if local_starts::date <> local_ends::date then
    raise exception 'La reserva tiene que empezar y terminar el mismo día.';
  end if;

  starts_weekday := extract(dow from local_starts);

  select exists (
    select 1
    from public.space_schedules s
    where s.space_id = new.space_id
      and s.weekday = starts_weekday
      and s.opens_at <= local_starts::time
      and s.closes_at >= local_ends::time
  ) into matches;

  if not matches then
    raise exception 'Este espacio no está disponible para reservar ese día u horario.';
  end if;

  return new;
end;
$$;

create trigger reservations_enforce_schedule
  before insert on public.reservations
  for each row
  execute function public.enforce_reservation_schedule();
