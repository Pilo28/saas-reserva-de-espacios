-- Los horarios de disponibilidad no soportaban ventanas que cruzan la medianoche (ej.
-- 20:00 a 03:00 del dia siguiente): el check "opens_at < closes_at" de la Fase 5 lo
-- impedia directamente. Se detecto al pedir soporte para ese caso real (quinchos que se
-- usan hasta la madrugada). Se saca ese check (buscado dinamicamente por columnas, no por
-- nombre, para no depender de como Postgres haya nombrado el constraint sin nombre
-- explicito) y se reemplaza por uno que solo evita una ventana de duracion cero.
do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.space_schedules'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%opens_at%closes_at%'
  loop
    execute format('alter table public.space_schedules drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.space_schedules
  add constraint space_schedules_opens_closes_different check (opens_at <> closes_at);

-- Ademas, el frontend ya no deja al vecino elegir un horario libre dentro de la ventana:
-- la reserva ES la ventana completa que configuro el admin para ese dia. Este trigger
-- (agregado en 20260902140000_enforce_reservation_schedule.sql) asumia que la reserva
-- empezaba y terminaba el mismo dia local, lo que rechazaba toda ventana que cruza
-- medianoche. Se reescribe para anclar la ventana [opens_at, closes_at) a partir de la
-- fecha local de inicio de la reserva, sumando un dia al cierre cuando closes_at <=
-- opens_at (ventana nocturna).
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
  starts_weekday := extract(dow from local_starts);

  select exists (
    select 1
    from public.space_schedules s
    where s.space_id = new.space_id
      and s.weekday = starts_weekday
      and local_starts >= (local_starts::date + s.opens_at)
      and local_ends <= (
        case
          when s.closes_at > s.opens_at then local_starts::date + s.closes_at
          else local_starts::date + 1 + s.closes_at
        end
      )
  ) into matches;

  if not matches then
    raise exception 'Este espacio no está disponible para reservar ese día u horario.';
  end if;

  return new;
end;
$$;
