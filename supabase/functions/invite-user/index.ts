// Edge Function: manda la invitacion por mail de verdad usando el mailer default de
// Supabase (auth.admin.inviteUserByEmail). Corre server-side porque necesita la
// service_role key, que nunca puede viajar al navegador.
//
// No re-implementa el chequeo de "es admin de este edificio": en cambio, verifica que ya
// exista una fila PENDING en building_invitations para ese mail+edificio, consultada con
// el JWT de quien llama (no con la service key) -- por RLS, building_invitations solo la
// puede haber creado un admin de ese edificio, asi que esta consulta ya prueba autorizacion
// sin duplicar la logica de is_admin_of.
//
// Variables de entorno: SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY son
// secrets reservados que Supabase ya deja disponibles en toda Edge Function (aparecen como
// "Deprecated" en el dashboard nuevo, pero siguen andando; no hace falta crearlos a mano).
// SITE_URL es el unico secret custom que hay que agregar (Project Settings > Edge Functions
// > Secrets), con la URL real del sitio en Vercel, para que el link del mail vuelva ahi.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PROJECT_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLISHABLE_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SITE_URL = Deno.env.get('SITE_URL') ?? '';

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

    const { email, buildingId } = await req.json();
    if (!email || !buildingId) return json({ error: 'Falta email o buildingId.' }, 400);

    const normalizedEmail = String(email).trim().toLowerCase();

    // Cliente "como el usuario que llama": respeta su RLS, no la bypassea.
    const callerClient = createClient(PROJECT_URL, PUBLISHABLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: invitation, error: invError } = await callerClient
      .from('building_invitations')
      .select('id')
      .eq('building_id', buildingId)
      .eq('email', normalizedEmail)
      .eq('status', 'pending')
      .maybeSingle();

    if (invError) return json({ error: invError.message }, 400);
    if (!invitation) {
      return json({ error: 'No hay una invitación pendiente para ese mail en ese edificio.' }, 403);
    }

    const adminClient = createClient(PROJECT_URL, SERVICE_ROLE_KEY);
    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: SITE_URL ? `${SITE_URL}/set-password` : undefined,
    });

    if (inviteError) {
      const alreadyRegistered = /already registered|already exists/i.test(inviteError.message ?? '');
      if (!alreadyRegistered) return json({ error: inviteError.message }, 400);
      return json({ ok: true, emailSent: false, reason: 'already_registered' });
    }

    return json({ ok: true, emailSent: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, 500);
  }
});
