// Prueba en vivo de las reglas de reserva de la Fase 7 contra un proyecto Supabase real:
// anticipacion minima/maxima, duracion maxima, maximo de reservas activas, minimo de
// cancelacion, y que el admin del edificio queda exento de todas ellas.
//
// Requiere las mismas tres variables que test-rls-isolation.mjs (ver SUPABASE.local.md):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Uso: correr contra un proyecto de DESARROLLO. Este script inserta y borra filas reales.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:rules

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
  const email = `rules-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const created = await admin.auth.admin.createUser({ email, password: 'test-password-123', email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, anon);
  const signIn = await client.auth.signInWithPassword({ email, password: 'test-password-123' });
  if (signIn.error) throw signIn.error;
  return { client, userId: signIn.data.user.id };
}

const isoInHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const isoInDays = (d) => new Date(Date.now() + d * 86_400_000).toISOString();

// enforce_reservation_schedule (agregada al probar en vivo) exige que la reserva caiga
// dentro de un horario configurado. Esta suite prueba las reglas de anticipacion/duracion,
// no los horarios, asi que el unico caso que necesita EXITO (test 4, "reserva valida") se
// fija a una hora lejos de cualquier medianoche -- para no depender de en que momento del
// dia se corra el script -- y se habilita ese dia entero.
function safeSlot(hoursFromNow, durationHours) {
  const start = new Date(Date.now() + hoursFromNow * 3600_000);
  start.setUTCHours(15, 0, 0, 0); // mediodia en Argentina (UTC-3), lejos de cualquier medianoche
  const end = new Date(start.getTime() + durationHours * 3600_000);
  return { startsAt: start.toISOString(), endsAt: end.toISOString(), weekday: start.getUTCDay() };
}

console.log('setup...');
const a1 = await newUser('a1'); // admin/creator del edificio
const a2 = await newUser('a2'); // vecino

const bA = await a1.client.from('buildings').insert({ name: 'Edif Reglas ' + Date.now(), created_by: a1.userId }).select().single();
if (bA.error) throw bA.error;

const addMember = await admin.from('building_members').insert({ building_id: bA.data.id, user_id: a2.userId, role: 'resident' });
if (addMember.error) throw addMember.error;

const space = await a1.client.from('spaces').insert({ building_id: bA.data.id, name: 'Quincho' }).select().single();
if (space.error) throw space.error;

const rules = await a1.client.from('space_rules').insert({
  space_id: space.data.id,
  building_id: bA.data.id,
  max_active_reservations_per_user: 1,
  min_advance_hours: 24,
  max_advance_days: 30,
  max_duration_hours: 4,
  min_cancellation_hours: 12,
}).select().single();
if (rules.error) throw rules.error;

console.log('\n1. anticipacion minima...');
const tooSoon = await a2.client.from('reservations').insert({ building_id: bA.data.id, space_id: space.data.id, user_id: a2.userId, starts_at: isoInHours(1), ends_at: isoInHours(2) });
tooSoon.error ? ok('vecino no puede reservar con solo 1h de anticipacion (minimo 24h)') : fail('deberia haber rechazado por anticipacion minima');

console.log('\n2. duracion maxima...');
const tooLong = await a2.client.from('reservations').insert({ building_id: bA.data.id, space_id: space.data.id, user_id: a2.userId, starts_at: isoInHours(48), ends_at: isoInHours(54) });
tooLong.error ? ok('vecino no puede reservar 6hs seguidas (maximo 4hs)') : fail('deberia haber rechazado por duracion maxima');

console.log('\n3. anticipacion maxima...');
const tooFar = await a2.client.from('reservations').insert({ building_id: bA.data.id, space_id: space.data.id, user_id: a2.userId, starts_at: isoInDays(60), ends_at: isoInDays(60.1) });
tooFar.error ? ok('vecino no puede reservar con 60 dias de anticipacion (maximo 30)') : fail('deberia haber rechazado por anticipacion maxima');

console.log('\n4. reserva valida dentro de todos los limites...');
const goodSlot = safeSlot(100, 2);
const goodSchedule = await a1.client.from('space_schedules').insert({ building_id: bA.data.id, space_id: space.data.id, weekday: goodSlot.weekday, opens_at: '00:00:01', closes_at: '23:59:00' });
if (goodSchedule.error) throw goodSchedule.error;
const good = await a2.client.from('reservations').insert({ building_id: bA.data.id, space_id: space.data.id, user_id: a2.userId, starts_at: goodSlot.startsAt, ends_at: goodSlot.endsAt }).select().single();
good.error ? fail('deberia poder reservar 2hs con ~100hs de anticipacion', JSON.stringify(good.error)) : ok('vecino reserva 2hs con ~100hs de anticipacion (dentro de todos los limites)');

console.log('\n5. maximo de reservas activas...');
const second = await a2.client.from('reservations').insert({ building_id: bA.data.id, space_id: space.data.id, user_id: a2.userId, starts_at: isoInHours(150), ends_at: isoInHours(152) });
second.error ? ok('vecino no puede tener una 2da reserva activa (maximo 1)') : fail('deberia haber rechazado por maximo de reservas activas');

console.log('\n6. el admin no esta sujeto a las reglas...');
const soonForCancel = await a1.client.from('reservations').insert({ building_id: bA.data.id, space_id: space.data.id, user_id: a2.userId, starts_at: isoInHours(3), ends_at: isoInHours(4) }).select().single();
soonForCancel.error
  ? fail('el admin deberia poder reservar en nombre de a2 sin respetar la anticipacion minima', JSON.stringify(soonForCancel.error))
  : ok('admin reserva en nombre de a2 con solo 3hs de anticipacion (excepcion valida, viola el minimo de 24hs)');

console.log('\n7. cancelacion minima...');
if (!soonForCancel.error) {
  const lateCancel = await a2.client.from('reservations').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: a2.userId }).eq('id', soonForCancel.data.id);
  lateCancel.error ? ok('vecino no puede cancelar con solo 3hs de anticipacion (minimo 12hs)') : fail('deberia haber rechazado la cancelacion tardia');

  const adminCancel = await a1.client.from('reservations').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: a1.userId }).eq('id', soonForCancel.data.id).select();
  adminCancel.error || adminCancel.data.length !== 1
    ? fail('el admin deberia poder cancelar aunque falten menos de 12hs', JSON.stringify(adminCancel))
    : ok('admin cancela sin respetar el minimo de cancelacion (excepcion valida)');
} else {
  fail('no se pudo montar el escenario de cancelacion tardia (ver paso 6)');
}

console.log('\nlimpiando...');
await admin.from('buildings').delete().eq('id', bA.data.id);
await admin.auth.admin.deleteUser(a1.userId);
await admin.auth.admin.deleteUser(a2.userId);

console.log('');
if (failures > 0) { console.error(failures + ' verificacion(es) fallaron.'); process.exit(1); }
console.log('Todas las verificaciones de reglas de reserva pasaron.');
