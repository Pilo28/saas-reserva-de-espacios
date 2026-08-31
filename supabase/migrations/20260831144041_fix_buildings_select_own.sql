-- Con INSERT ... RETURNING, Postgres evalua la policy de SELECT sobre la fila nueva
-- dentro de la misma sentencia, antes de que el trigger on_building_created (que crea
-- la membresia de admin) quede visible para esa evaluacion. Sin este ajuste, cualquier
-- alta de edificio que pida el registro de vuelta (el patron normal de la UI) fallaba
-- con "new row violates row-level security policy", aunque el insert en si era valido.
-- Ademas tiene sentido por si solo: quien crea un edificio deberia poder verlo siempre.
drop policy "buildings_select_members" on public.buildings;

create policy "buildings_select_members"
  on public.buildings for select
  using (created_by = auth.uid() or public.is_member_of(id) or public.is_platform_admin());
