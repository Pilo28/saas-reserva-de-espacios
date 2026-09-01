-- El dashboard de la Fase 8 necesita que el admin de un edificio pueda ver el nombre del
-- vecino detras de cada reserva, no solo su user_id. Hasta ahora "profiles" solo dejaba ver
-- el propio perfil (profiles_select_own). Esta policy agrega: un admin puede ver el profile
-- de cualquier usuario que sea miembro de un edificio que el administra.
--
-- is_admin_of ya es security definer (ver fix_rls_helper_recursion), asi que esta subquery
-- sobre building_members no reintroduce el problema de recursion: is_admin_of resuelve su
-- propia fila sin volver a pasar por la policy de "profiles".
create policy "profiles_select_admin_of_shared_building"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.building_members bm
      where bm.user_id = profiles.id
        and public.is_admin_of(bm.building_id)
    )
  );
