-- is_member_of/is_admin_of consultan building_members, que tiene una policy de SELECT
-- que a su vez llama a is_admin_of. El supuesto original era que el "OR" de esa policy
-- hace short-circuit sobre la fila propia antes de volver a evaluar is_admin_of, pero
-- Postgres no garantiza el orden de evaluacion de un OR dentro de una policy: el planner
-- puede reordenar las clausulas y terminar llamando a la funcion antes que el filtro
-- "propio", entrando en recursion infinita ("stack depth limit exceeded").
--
-- La solucion estandar de Supabase: estas funciones deben ser security definer, para que
-- su consulta interna corra sin RLS (como el dueno de la tabla) y nunca vuelva a evaluar
-- la policy que las llamo. Siguen siendo seguras: solo devuelven boolean, no exponen filas.
create or replace function public.is_member_of(target_building_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.building_members
    where building_id = target_building_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_admin_of(target_building_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.building_members
    where building_id = target_building_id
      and user_id = auth.uid()
      and role = 'admin'
  );
$$;
