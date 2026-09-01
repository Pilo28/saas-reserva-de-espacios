-- Bug encontrado al probar en vivo: "profiles_select_shared_building_member" (Fase 11.5)
-- hacia "select ... from building_members bm where bm.user_id = profiles.id and
-- is_member_of(bm.building_id)" directo dentro del USING de una policy de "profiles". Esa
-- subquery sobre building_members corre con los privilegios del que consulta (no es
-- security definer), asi que queda sujeta a la policy de building_members
-- (building_members_select_own_or_admin: propia fila o admin). Resultado: un admin veia a
-- sus vecinos (puede leer todas las filas de su edificio), pero un resident NO veia la fila
-- de membresia de otro miembro (no es ni su fila ni es admin) -> la funcion EXISTS daba
-- falso siempre para vecino-ve-a-vecino. Mismo problema de fondo que ya se documento en
-- fix_rls_helper_recursion.sql: la solucion es security definer.
create or replace function public.shares_building_with(target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.building_members bm
    where bm.user_id = target_user_id
      and public.is_member_of(bm.building_id)
  );
$$;

drop policy "profiles_select_shared_building_member" on public.profiles;

create policy "profiles_select_shared_building_member"
  on public.profiles for select
  using (public.shares_building_with(profiles.id));
