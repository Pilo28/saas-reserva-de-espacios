// Prueba en vivo del mecanismo central de reservas contra un proyecto Supabase real:
// el exclusion constraint anti-doble-reserva, que cancelar libera el horario, la vista
// de privacidad reservation_slots, y el aislamiento entre edificios.
//
// Requiere las mismas tres variables que test-rls-isolation.mjs (ver SUPABASE.local.md):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Uso: correr contra un proyecto de DESARROLLO. Este script inserta y borra filas reales.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:reservations

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
  const email = `reservations-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const created = await admin.auth.admin.createUser({ email, password: 'test-password-123', email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, anon);
  const signIn = await client.auth.signInWithPassword({ email, password: 'test-password-123' });
  if (signIn.error) throw signIn.error;
  return { client, userId: signIn.data.user.id };
}

console.log('setup...');
const a1 = await newUser('a1'); // admin/creator del edificio A
const a2 = await newUser('a2'); // vecino del edificio A (agregado a mano, como haria el invite de la Fase 8)
const b1 = await newUser('b1'); // usuario de otro edificio

const bA = await a1.client.from('buildings').insert({ name: 'Edif A ' + Date.now(), created_by: a1.userId }).select().single();
if (bA.error) throw bA.error;

// suma a a2 como resident de bA (bypass del invite, que todavia no existe -- Fase 8)
const addMember = await admin.from('building_members').insert({ building_id: bA.data.id, user_id: a2.userId, role: 'resident' });
if (addMember.error) throw addMember.error;

const bB = await b1.client.from('buildings').insert({ name: 'Edif B ' + Date.now(), created_by: b1.userId }).select().single();
if (bB.error) throw bB.error;

const spaceA = await a1.client.from('spaces').insert({ building_id: bA.data.id, name: 'Quincho' }).select().single();
if (spaceA.error) throw spaceA.error;
const spaceB = await b1.client.from('spaces').insert({ building_id: bB.data.id, name: 'Quincho B' }).select().single();
if (spaceB.error) throw spaceB.error;

const day = new Date();
day.setUTCDate(day.getUTCDate() + 7);
const dateStr = day.toISOString().slice(0, 10);
const range = (h1, h2) => [`${dateStr}T${String(h1).padStart(2, '0')}:00:00Z`, `${dateStr}T${String(h2).padStart(2, '0')}:00:00Z`];

// enforce_reservation_schedule (agregada al probar en vivo) exige un horario de
// disponibilidad configurado; este script prueba el exclusion constraint, no los
// horarios, asi que se habilita todo el dia elegido para no interferir.
const scheduleWeekday = day.getUTCDay();
const daySchedule = await a1.client.from('space_schedules').insert({ building_id: bA.data.id, space_id: spaceA.data.id, weekday: scheduleWeekday, opens_at: '00:00:01', closes_at: '23:59:00' });
if (daySchedule.error) throw daySchedule.error;

console.log('\n1. anti-doble-reserva...');
const [s1, e1] = range(18, 22);
const res1 = await a2.client.from('reservations').insert({ building_id: bA.data.id, space_id: spaceA.data.id, user_id: a2.userId, starts_at: s1, ends_at: e1 }).select().single();
res1.error ? fail('A2 deberia poder reservar 18-22', JSON.stringify(res1.error)) : ok('A2 reserva el quincho 18-22');

const [s2, e2] = range(19, 21); // completamente adentro de 18-22
const overlap1 = await a1.client.from('reservations').insert({ building_id: bA.data.id, space_id: spaceA.data.id, user_id: a1.userId, starts_at: s2, ends_at: e2 });
overlap1.error ? ok('A1 no puede reservar 19-21 (adentro de la reserva de A2)') : fail('deberia haber rechazado el solapamiento interno');

const [s3, e3] = range(21, 23); // se solapa parcialmente al final
const overlap2 = await a1.client.from('reservations').insert({ building_id: bA.data.id, space_id: spaceA.data.id, user_id: a1.userId, starts_at: s3, ends_at: e3 });
overlap2.error ? ok('A1 no puede reservar 21-23 (se solapa el final)') : fail('deberia haber rechazado el solapamiento parcial');

const [s4, e4] = range(22, 23); // exactamente despues, sin solapar (rango semi-abierto)
const adjacent = await a1.client.from('reservations').insert({ building_id: bA.data.id, space_id: spaceA.data.id, user_id: a1.userId, starts_at: s4, ends_at: e4 }).select().single();
adjacent.error ? fail('A1 deberia poder reservar 22-23 (justo despues, sin solapar)', JSON.stringify(adjacent.error)) : ok('A1 reserva 22-23 (adyacente, no solapa)');

console.log('\n2. cancelar libera el horario...');
const cancel = await a2.client.from('reservations').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: a2.userId }).eq('id', res1.data.id).select();
cancel.error || cancel.data.length !== 1 ? fail('A2 deberia poder cancelar su propia reserva', JSON.stringify(cancel)) : ok('A2 cancela su reserva 18-22');

const rebooked = await a1.client.from('reservations').insert({ building_id: bA.data.id, space_id: spaceA.data.id, user_id: a1.userId, starts_at: s1, ends_at: e1 }).select().single();
rebooked.error ? fail('deberia poder reservarse 18-22 de nuevo tras la cancelacion', JSON.stringify(rebooked.error)) : ok('el horario 18-22 vuelve a estar libre tras la cancelacion');

console.log('\n3. privacidad: reservation_slots vs reservations completa...');
const a2SeesFullViaTable = await a2.client.from('reservations').select('id').eq('id', rebooked.data.id);
a2SeesFullViaTable.data?.length === 0 ? ok('A2 NO ve la reserva de A1 en la tabla completa (no es dueno ni admin)') : fail('A2 no deberia ver la fila completa de la reserva de A1', JSON.stringify(a2SeesFullViaTable));

const a2SeesSlot = await a2.client.from('reservation_slots').select('id, starts_at, ends_at, status, user_id').eq('id', rebooked.data.id).maybeSingle();
a2SeesSlot.data?.user_id === a1.userId ? ok('A2 ve el horario ocupado Y quien lo reservo (Fase 11.5) via reservation_slots (sin notas)') : fail('A2 deberia ver el slot y el user_id del dueno en reservation_slots', JSON.stringify(a2SeesSlot));

const b1SeesSlotOfA = await b1.client.from('reservation_slots').select('id').eq('id', rebooked.data.id);
b1SeesSlotOfA.data?.length === 0 ? ok('B1 (otro edificio) NO ve el slot de A1 en reservation_slots') : fail('B1 no deberia ver reservas del edificio A', JSON.stringify(b1SeesSlotOfA));

console.log('\n4. aislamiento cruzado de reservas...');
const b1CreatesInA = await b1.client.from('reservations').insert({ building_id: bA.data.id, space_id: spaceA.data.id, user_id: b1.userId, starts_at: range(10, 11)[0], ends_at: range(10, 11)[1] });
b1CreatesInA.error ? ok('B1 no puede reservar un espacio del edificio A') : fail('B1 no deberia poder reservar en el edificio A');

console.log('\n5. admin cancela reserva de un vecino...');
const adminCancels = await a1.client.from('reservations').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: a1.userId }).eq('id', adjacent.data.id).select();
adminCancels.error || adminCancels.data.length !== 1 ? fail('A1 (admin) deberia poder cancelar la reserva de otro', JSON.stringify(adminCancels)) : ok('A1 (admin) cancela la reserva de otro miembro');

console.log('\nlimpiando...');
await admin.from('buildings').delete().in('id', [bA.data.id, bB.data.id]);
await admin.auth.admin.deleteUser(a1.userId);
await admin.auth.admin.deleteUser(a2.userId);
await admin.auth.admin.deleteUser(b1.userId);

console.log('');
if (failures > 0) { console.error(failures + ' verificacion(es) fallaron.'); process.exit(1); }
console.log('Todas las verificaciones de reservas pasaron.');
