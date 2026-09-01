-- Dos pedidos del usuario tras probar en real:
-- 1. Que un vecino vea piso/depto de quien ocupa un horario (no solo el nombre), igual
--    que ya puede ver el nombre desde la Fase 11.5. Hoy building_members solo lo puede
--    leer el propio dueno de la fila o el admin del edificio -- se relaja al mismo
--    criterio que ya se uso para profiles.full_name: cualquier miembro del edificio.
-- 2. Que el admin pueda ver el mail de sus vecinos en la pantalla "Vecinos". El mail vive
--    en auth.users, no en profiles, y a diferencia del nombre NO se comparte entre
--    vecinos (ver decision del usuario) -- se expone via una funcion security definer
--    que valida is_admin_of antes de leer, en vez de agregar una columna a profiles que
--    heredaria la visibilidad amplia de profiles_select_shared_building_member.

drop policy "building_members_select_own_or_admin" on public.building_members;

create policy "building_members_select_shared_building"
  on public.building_members for select
  using (public.is_member_of(building_id));

create or replace function public.get_building_member_emails(target_building_id uuid)
returns table (user_id uuid, email text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_admin_of(target_building_id) then
    raise exception 'No tenés permiso para ver los mails de este edificio.';
  end if;

  return query
    select bm.user_id, u.email::text
    from public.building_members bm
    join auth.users u on u.id = bm.user_id
    where bm.building_id = target_building_id;
end;
$$;

grant execute on function public.get_building_member_emails(uuid) to authenticated;
