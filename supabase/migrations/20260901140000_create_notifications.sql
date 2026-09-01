-- Notificaciones web in-app (Fase 9, primera etapa sin email/WhatsApp). No guardamos texto
-- pre-armado: solo el tipo de evento y el reservation_id, y el frontend arma el mensaje
-- uniendo con reservations/spaces (mismo criterio que reservations.service.ts para
-- spaces/buildings). Evita hornear fechas en un huso horario fijo en el servidor.

create type public.notification_type as enum (
  'reservation_created',
  'reservation_cancelled',
  'reservation_reminder'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  building_id uuid not null references public.buildings (id) on delete cascade,
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  type public.notification_type not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Sin policy de insert/delete: las crean unicamente los triggers de abajo (security
-- definer), igual criterio que "profiles" con handle_new_user.
create policy "notifications_select_own"
  on public.notifications for select
  using (user_id = auth.uid());

create policy "notifications_update_own"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.notify_reservation_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, building_id, reservation_id, type)
  values (new.user_id, new.building_id, new.id, 'reservation_created');
  return new;
end;
$$;

create trigger reservations_notify_created
  after insert on public.reservations
  for each row
  execute function public.notify_reservation_created();

create or replace function public.notify_reservation_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'cancelled' or old.status = 'cancelled' then
    return new;
  end if;

  insert into public.notifications (user_id, building_id, reservation_id, type)
  values (new.user_id, new.building_id, new.id, 'reservation_cancelled');
  return new;
end;
$$;

create trigger reservations_notify_cancelled
  after update on public.reservations
  for each row
  execute function public.notify_reservation_cancelled();

-- Los recordatorios son por tiempo, no por un cambio de fila, asi que no hay trigger que
-- los dispare. Sin pg_cron disponible de forma segura en el plan del proyecto, esta funcion
-- se llama "al paso" desde el frontend (al entrar a Home) para cualquier usuario logueado:
-- barre TODAS las reservas de TODOS los edificios que arrancan en la proxima hora y todavia
-- no tienen recordatorio (el "not exists" la hace idempotente, se puede llamar mil veces).
-- Es segura para exponer via RPC: no devuelve datos y cada quien solo puede leer sus propias
-- notificaciones (notifications_select_own).
create or replace function public.generate_reservation_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, building_id, reservation_id, type)
  select r.user_id, r.building_id, r.id, 'reservation_reminder'
  from public.reservations r
  where r.status = 'confirmed'
    and r.starts_at > now()
    and r.starts_at <= now() + interval '1 hour'
    and not exists (
      select 1 from public.notifications n
      where n.reservation_id = r.id and n.type = 'reservation_reminder'
    );
end;
$$;

grant execute on function public.generate_reservation_reminders() to authenticated;
