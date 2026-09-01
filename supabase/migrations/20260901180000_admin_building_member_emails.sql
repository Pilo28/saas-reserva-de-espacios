-- El panel del administrador (Fase 8) necesita el mail de quien reservo/cancelo, no solo
-- el nombre, para poder contactarlo ante un problema con el espacio. El mail vive en
-- auth.users, no en profiles, y no se comparte con el criterio amplio de
-- profiles_select_shared_building_member (eso es solo para el nombre) -- se expone via
-- una funcion security definer que valida is_admin_of antes de leer.
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
