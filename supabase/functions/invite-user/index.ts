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
// Variables de entorno: se configuran todas a mano en Project Settings > Edge Functions >
// Secrets (no se depende de las que Supabase inyecta automaticamente, cuyo nombre puede
// variar entre versiones del runtime/esquema de keys):
//   PROJECT_URL       - URL del proyecto (la misma que SUPABASE_URL del frontend)
//   PUBLISHABLE_KEY   - la anon/publishable key (publica, ya vive en el frontend)
//   SERVICE_ROLE_KEY  - la secret/service_role key (nunca al frontend)
//   SITE_URL          - URL real del sitio en Vercel, para que el link del mail vuelva ahi

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PROJECT_URL = Deno.env.get('PROJECT_URL')!;
const PUBLISHABLE_KEY = Deno.env.get('PUBLISHABLE_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY')!;
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
