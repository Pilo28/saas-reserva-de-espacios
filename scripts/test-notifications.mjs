// Prueba en vivo de las notificaciones web in-app de la Fase 9: se generan al crear y
// cancelar una reserva, el recordatorio se genera via RPC de forma idempotente, y el
// aislamiento (cada quien ve solo las propias) se respeta.
//
// Requiere las mismas tres variables que test-rls-isolation.mjs (ver SUPABASE.local.md):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Uso: correr contra un proyecto de DESARROLLO. Este script inserta y borra filas reales.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:notifications

import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon || !svc) {
  console.error(
    'Faltan variables de entorno. Necesitás SUPABASE_URL, SUPABASE_ANON_KEY y ' +
      'SUPABASE_SERVICE_ROLE_KEY (ver SUPABASE.local.md). Nunca contra un proyecto de producción.',
  );
  process.exit(1);
}

const admin = createClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false } });

let failures = 0;
function ok(desc) { console.log('  ok   ' + desc); }
function fail(desc, detail) { failures++; console.error('  FAIL ' + desc); if (detail) console.error('       ' + detail); }

async function newUser(label) {
  const email = `notif-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const created = await admin.auth.admin.createUser({ email, password: 'test-password-123', email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, anon);
  const signIn = await client.auth.signInWithPassword({ email, password: 'test-password-123' });
  if (signIn.error) throw signIn.error;
  return { client, userId: signIn.data.user.id };
}

const isoInMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

console.log('setup...');
const a1 = await newUser('a1'); // admin del edificio
const a2 = await newUser('a2'); // vecino

const bA = await a1.client.from('buildings').insert({ name: 'Edif Notif ' + Date.now(), created_by: a1.userId }).select().single();
if (bA.error) throw bA.error;

const addMember = await admin.from('building_members').insert({ building_id: bA.data.id, user_id: a2.userId, role: 'resident' });
if (addMember.error) throw addMember.error;

const space = await a1.client.from('spaces').insert({ building_id: bA.data.id, name: 'Quincho' }).select().single();
if (space.error) throw space.error;

console.log('\n1. crear una reserva genera una notificacion...');
const res1 = await a2.client.from('reservations').insert({ building_id: bA.data.id, space_id: space.data.id, user_id: a2.userId, starts_at: isoInMinutes(120), ends_at: isoInMinutes(180) }).select().single();
if (res1.error) throw res1.error;

const createdNotif = await a2.client.from('notifications').select('id, type').eq('reservation_id', res1.data.id).eq('type', 'reservation_created').maybeSingle();
createdNotif.data ? ok('A2 tiene una notificacion "reservation_created" para su reserva') : fail('deberia haberse generado la notificacion de creacion', JSON.stringify(createdNotif));

console.log('\n2. otro usuario no ve esa notificacion...');
const a1SeesA2Notif = await a1.client.from('notifications').select('id').eq('reservation_id', res1.data.id);
a1SeesA2Notif.data?.length === 0 ? ok('A1 (admin) no ve la notificacion de A2 (no es suya)') : fail('A1 no deberia ver la notificacion de A2', JSON.stringify(a1SeesA2Notif));

console.log('\n3. cancelar genera una notificacion de cancelacion...');
const cancel = await a2.client.from('reservations').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: a2.userId }).eq('id', res1.data.id);
if (cancel.error) throw cancel.error;

const cancelledNotif = await a2.client.from('notifications').select('id').eq('reservation_id', res1.data.id).eq('type', 'reservation_cancelled').maybeSingle();
cancelledNotif.data ? ok('A2 tiene una notificacion "reservation_cancelled"') : fail('deberia haberse generado la notificacion de cancelacion', JSON.stringify(cancelledNotif));

console.log('\n4. recordatorio: se genera para una reserva que arranca en breve...');
const soonRes = await a1.client.from('reservations').insert({ building_id: bA.data.id, space_id: space.data.id, user_id: a2.userId, starts_at: isoInMinutes(30), ends_at: isoInMinutes(60) }).select().single();
if (soonRes.error) throw soonRes.error;

const rpc1 = await a2.client.rpc('generate_reservation_reminders');
if (rpc1.error) throw rpc1.error;

const reminder1 = await a2.client.from('notifications').select('id').eq('reservation_id', soonRes.data.id).eq('type', 'reservation_reminder');
reminder1.data?.length === 1 ? ok('se genero exactamente 1 recordatorio para la reserva que arranca en 30min') : fail('deberia haber exactamente 1 recordatorio', JSON.stringify(reminder1));

console.log('\n5. el recordatorio es idempotente (no se duplica)...');
const rpc2 = await a2.client.rpc('generate_reservation_reminders');
if (rpc2.error) throw rpc2.error;
const reminder2 = await a2.client.from('notifications').select('id').eq('reservation_id', soonRes.data.id).eq('type', 'reservation_reminder');
reminder2.data?.length === 1 ? ok('llamar el RPC de nuevo no duplica el recordatorio') : fail('el recordatorio no deberia duplicarse', JSON.stringify(reminder2));

console.log('\n6. marcar como leida...');
const markRead = await a2.client.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', reminder1.data[0].id).select();
markRead.error || markRead.data.length !== 1 ? fail('A2 deberia poder marcar su notificacion como leida', JSON.stringify(markRead)) : ok('A2 marca su notificacion como leida');

console.log('\nlimpiando...');
await admin.from('buildings').delete().eq('id', bA.data.id);
await admin.auth.admin.deleteUser(a1.userId);
await admin.auth.admin.deleteUser(a2.userId);

console.log('');
if (failures > 0) { console.error(failures + ' verificacion(es) fallaron.'); process.exit(1); }
console.log('Todas las verificaciones de notificaciones pasaron.');
