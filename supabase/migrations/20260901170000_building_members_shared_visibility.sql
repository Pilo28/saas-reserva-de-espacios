-- Que un vecino vea piso/depto de quien ocupa un horario (no solo el nombre), igual que ya
-- puede ver el nombre desde la Fase 11.5. Hoy building_members solo lo puede leer el propio
-- dueno de la fila o el admin del edificio -- se relaja al mismo criterio que ya se uso
-- para profiles.full_name: cualquier miembro del edificio.

drop policy "building_members_select_own_or_admin" on public.building_members;

create policy "building_members_select_shared_building"
  on public.building_members for select
  using (public.is_member_of(building_id));
