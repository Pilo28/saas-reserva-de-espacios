// Edge Function: el admin de un edificio cambia el mail de login de un vecino ya dado de
// alta. Corre server-side porque auth.admin.updateUserById necesita la service_role key,
// que nunca puede viajar al navegador.
//
// El chequeo de autorizacion NO se apoya en RLS de building_members (esa policy hoy deja
// leer a cualquier miembro del edificio, no solo al admin -- ver
// 20260901170000_building_members_shared_visibility.sql): en cambio, se consulta con el
// JWT de quien llama la fila del PROPIO caller en building_members y se valida a mano que
// su role sea 'admin' en ese building_id.
//
// Cambio inmediato, sin flujo de confirmacion por mail (decision explicita del usuario):
// email_confirm: true dado desde la API de admin marca el mail como confirmado al toque,
// no dispara el "secure email change" de dos pasos que si aplica cuando el propio usuario
// cambia su mail desde el cliente.
//
// Variables de entorno: SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY son
// secrets reservados que Supabase ya deja disponibles en toda Edge Function.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PROJECT_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLISHABLE_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Falta autenticación.' }, 401);

    const { buildingId, memberId, newEmail } = await req.json();
    if (!buildingId || !memberId || !newEmail) {
      return json({ error: 'Falta buildingId, memberId o newEmail.' }, 400);
    }

    const normalizedEmail = String(newEmail).trim().toLowerCase();

    // Cliente "como el usuario que llama": respeta su RLS, no la bypassea.
    const callerClient = createClient(PROJECT_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: callerUser, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerUser.user) return json({ error: 'Sesión inválida.' }, 401);

    const { data: callerMembership, error: membershipError } = await callerClient
      .from('building_members')
      .select('role')
      .eq('building_id', buildingId)
      .eq('user_id', callerUser.user.id)
      .maybeSingle();

    if (membershipError) return json({ error: membershipError.message }, 400);
    if (callerMembership?.role !== 'admin') {
      return json({ error: 'No sos administrador de este edificio.' }, 403);
    }

    const adminClient = createClient(PROJECT_URL, SERVICE_ROLE_KEY);

    const { data: targetMember, error: targetError } = await adminClient
      .from('building_members')
      .select('user_id')
      .eq('id', memberId)
      .eq('building_id', buildingId)
      .maybeSingle();

    if (targetError) return json({ error: targetError.message }, 400);
    if (!targetMember) return json({ error: 'No encontramos ese vecino en este edificio.' }, 404);

    const { error: updateError } = await adminClient.auth.admin.updateUserById(targetMember.user_id, {
      email: normalizedEmail,
      email_confirm: true,
    });

    if (updateError) return json({ error: updateError.message }, 400);

    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, 500);
  }
});
