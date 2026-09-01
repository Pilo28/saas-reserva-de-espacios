-- Reglas de reserva configurables por espacio: le dan al admin las palancas para limitar
-- cuanto y como reserva un vecino, sin que tenga que intervenir a mano en cada caso.
-- Un espacio sin fila en esta tabla no tiene ningun limite (todos los campos son opcionales).

create table public.space_rules (
  space_id uuid primary key references public.spaces (id) on delete cascade,
  building_id uuid not null references public.buildings (id) on delete cascade,
  max_active_reservations_per_user int check (max_active_reservations_per_user is null or max_active_reservations_per_user > 0),
  min_advance_hours int check (min_advance_hours is null or min_advance_hours >= 0),
  max_advance_days int check (max_advance_days is null or max_advance_days > 0),
  max_duration_hours int check (max_duration_hours is null or max_duration_hours > 0),
  min_cancellation_hours int check (min_cancellation_hours is null or min_cancellation_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index space_rules_building_id_idx on public.space_rules (building_id);

alter table public.space_rules enable row level security;

create trigger space_rules_set_updated_at
  before update on public.space_rules
  for each row
  execute function public.set_updated_at();

create policy "space_rules_select_members"
  on public.space_rules for select
  using (public.is_member_of(building_id));

create policy "space_rules_insert_admins"
  on public.space_rules for insert
  with check (public.is_admin_of(building_id));

create policy "space_rules_update_admins"
  on public.space_rules for update
  using (public.is_admin_of(building_id));

create policy "space_rules_delete_admins"
  on public.space_rules for delete
  using (public.is_admin_of(building_id));

-- Enforcement a nivel de base de datos, mismo criterio que el anti-doble-reserva de la
-- Fase 6: la app no puede ser la unica barrera. El admin del edificio (o quien reserva en
-- su nombre) queda exento -- es quien resuelve la excepcion cuando un vecino la necesita,
-- asi que no tiene sentido que estas reglas lo limiten a el.
create or replace function public.enforce_reservation_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rules public.space_rules%rowtype;
  active_count int;
begin
  if public.is_admin_of(new.building_id) then
    return new;
  end if;

  select * into rules from public.space_rules where space_id = new.space_id;
  if not found then
    return new;
  end if;

  if rules.max_duration_hours is not null
     and (extract(epoch from (new.ends_at - new.starts_at)) / 3600) > rules.max_duration_hours then
    raise exception 'Esta reserva dura mas de % horas, el maximo permitido para este espacio.', rules.max_duration_hours;
  end if;

  if rules.min_advance_hours is not null
     and new.starts_at < now() + make_interval(hours => rules.min_advance_hours) then
    raise exception 'Este espacio requiere reservar con al menos % horas de anticipacion.', rules.min_advance_hours;
  end if;

  if rules.max_advance_days is not null
     and new.starts_at > now() + make_interval(days => rules.max_advance_days) then
    raise exception 'Este espacio no admite reservas con mas de % dias de anticipacion.', rules.max_advance_days;
  end if;

  if rules.max_active_reservations_per_user is not null then
    select count(*) into active_count
    from public.reservations
    where space_id = new.space_id
      and user_id = new.user_id
      and status = 'confirmed'
      and ends_at > now();

    if active_count >= rules.max_active_reservations_per_user then
      raise exception 'Ya tenes % reserva(s) activa(s) en este espacio, el maximo permitido.', rules.max_active_reservations_per_user;
    end if;
  end if;

  return new;
end;
$$;

create trigger reservations_enforce_rules_insert
  before insert on public.reservations
  for each row
  execute function public.enforce_reservation_rules();

create or replace function public.enforce_cancellation_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rules public.space_rules%rowtype;
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' then
    return new;
  end if;

  if public.is_admin_of(new.building_id) then
    return new;
  end if;

  select * into rules from public.space_rules where space_id = new.space_id;
  if not found or rules.min_cancellation_hours is null then
    return new;
  end if;

  if old.starts_at - now() < make_interval(hours => rules.min_cancellation_hours) then
    raise exception 'No podes cancelar esta reserva: faltan menos de % horas para el inicio.', rules.min_cancellation_hours;
  end if;

  return new;
end;
$$;

create trigger reservations_enforce_rules_update
  before update on public.reservations
  for each row
  execute function public.enforce_cancellation_rules();
