// Prueba en vivo de la policy de "profiles" agregada en la Fase 8 para el dashboard del
// administrador: un admin puede ver el nombre de los miembros de SU edificio, pero no el de
// miembros de otro edificio, y un vecino comun no puede ver el nombre de nadie mas.
//
// Requiere las mismas tres variables que test-rls-isolation.mjs (ver SUPABASE.local.md):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Uso: correr contra un proyecto de DESARROLLO. Este script inserta y borra filas reales.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:dashboard

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
  const email = `dashboard-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const created = await admin.auth.admin.createUser({ email, password: 'test-password-123', email_confirm: true, user_metadata: { full_name: `Nombre ${label}` } });
  if (created.error) throw created.error;
  const client = createClient(url, anon);
  const signIn = await client.auth.signInWithPassword({ email, password: 'test-password-123' });
  if (signIn.error) throw signIn.error;
  return { client, userId: signIn.data.user.id };
}

console.log('setup...');
const a1 = await newUser('a1'); // admin del edificio A
const a2 = await newUser('a2'); // vecino del edificio A
const b1 = await newUser('b1'); // admin de otro edificio

const bA = await a1.client.from('buildings').insert({ name: 'Edif Dashboard A ' + Date.now(), created_by: a1.userId }).select().single();
if (bA.error) throw bA.error;

const addMember = await admin.from('building_members').insert({ building_id: bA.data.id, user_id: a2.userId, role: 'resident' });
if (addMember.error) throw addMember.error;

const bB = await b1.client.from('buildings').insert({ name: 'Edif Dashboard B ' + Date.now(), created_by: b1.userId }).select().single();
if (bB.error) throw bB.error;

console.log('\n1. el admin ve el nombre de su vecino...');
const a1SeesA2 = await a1.client.from('profiles').select('id, full_name').eq('id', a2.userId).maybeSingle();
a1SeesA2.data?.full_name ? ok(`A1 (admin) ve el nombre de A2: "${a1SeesA2.data.full_name}"`) : fail('A1 deberia poder ver el nombre de A2', JSON.stringify(a1SeesA2));

console.log('\n2. el admin de OTRO edificio NO ve el nombre...');
const b1SeesA2 = await b1.client.from('profiles').select('id, full_name').eq('id', a2.userId).maybeSingle();
b1SeesA2.data ? fail('B1 (admin de otro edificio) no deberia ver el nombre de A2', JSON.stringify(b1SeesA2)) : ok('B1 (admin de otro edificio) NO ve el nombre de A2');

console.log('\n3. un vecino comun no ve el nombre de otro...');
const a2SeesA1 = await a2.client.from('profiles').select('id, full_name').eq('id', a1.userId).maybeSingle();
a2SeesA1.data ? fail('A2 (vecino) no deberia ver el nombre de A1', JSON.stringify(a2SeesA1)) : ok('A2 (vecino) NO ve el nombre de A1 (ni siquiera el de su admin)');

console.log('\n4. todos pueden seguir viendo su propio nombre...');
const a2SeesSelf = await a2.client.from('profiles').select('id, full_name').eq('id', a2.userId).maybeSingle();
a2SeesSelf.data?.full_name ? ok('A2 ve su propio nombre') : fail('A2 deberia poder ver su propio nombre', JSON.stringify(a2SeesSelf));

console.log('\n5. datos del panel: hoy, ocupacion, alertas y proximos dias...');
const space = await a1.client.from('spaces').insert({ building_id: bA.data.id, name: 'Quincho' }).select().single();
if (space.error) throw space.error;

const iso = (mins) => new Date(Date.now() + mins * 60_000).toISOString();

const nowRes = await a1.client.from('reservations').insert({ building_id: bA.data.id, space_id: space.data.id, user_id: a2.userId, starts_at: iso(-30), ends_at: iso(30) }).select().single();
const soonRes = await a1.client.from('reservations').insert({ building_id: bA.data.id, space_id: space.data.id, user_id: a2.userId, starts_at: iso(45), ends_at: iso(75) }).select().single();
const tomorrowRes = await a1.client.from('reservations').insert({ building_id: bA.data.id, space_id: space.data.id, user_id: a2.userId, starts_at: iso(60 * 30), ends_at: iso(60 * 31) }).select().single();
if (nowRes.error || soonRes.error || tomorrowRes.error) throw nowRes.error || soonRes.error || tomorrowRes.error;

const cancelledRes = await a1.client.from('reservations').insert({ building_id: bA.data.id, space_id: space.data.id, user_id: a2.userId, starts_at: iso(60 * 50), ends_at: iso(60 * 51) }).select().single();
if (cancelledRes.error) throw cancelledRes.error;
const cancelled = await a1.client.from('reservations').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: a1.userId }).eq('id', cancelledRes.data.id);
if (cancelled.error) throw cancelled.error;

const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate() + 1);
const weekEnd = new Date(todayStart); weekEnd.setDate(weekEnd.getDate() + 7);

const upcoming = await a1.client.from('reservations').select('id, space_id, starts_at, ends_at').eq('building_id', bA.data.id).eq('status', 'confirmed').gte('starts_at', todayStart.toISOString()).lt('starts_at', weekEnd.toISOString());
if (upcoming.error) throw upcoming.error;

const todayIds = upcoming.data.filter((r) => new Date(r.starts_at) < tomorrowStart).map((r) => r.id);
const upcomingIds = upcoming.data.filter((r) => new Date(r.starts_at) >= tomorrowStart).map((r) => r.id);
const occupiedNow = upcoming.data.some((r) => new Date(r.starts_at) <= new Date() && new Date(r.ends_at) > new Date());

todayIds.includes(nowRes.data.id) && todayIds.includes(soonRes.data.id)
  ? ok('la reserva "ahora" y la "en 45min" caen dentro de la ventana de hoy')
  : fail('deberian estar ambas en la ventana de hoy', JSON.stringify(todayIds));

upcomingIds.includes(tomorrowRes.data.id) ? ok('la reserva de manana cae en "proximos dias"') : fail('deberia estar en proximos dias', JSON.stringify(upcomingIds));

occupiedNow ? ok('el espacio figura ocupado ahora (reserva en curso)') : fail('deberia detectar el espacio como ocupado ahora');

const cancelledToday = await a1.client.from('reservations').select('id').eq('building_id', bA.data.id).eq('status', 'cancelled').gte('cancelled_at', todayStart.toISOString()).lt('cancelled_at', tomorrowStart.toISOString());
cancelledToday.data?.some((r) => r.id === cancelledRes.data.id) ? ok('la cancelacion de hoy aparece en el rango de "canceladas hoy"') : fail('deberia aparecer la cancelacion de hoy', JSON.stringify(cancelledToday));

console.log('\nlimpiando...');
await admin.from('buildings').delete().in('id', [bA.data.id, bB.data.id]);
await admin.auth.admin.deleteUser(a1.userId);
await admin.auth.admin.deleteUser(a2.userId);
await admin.auth.admin.deleteUser(b1.userId);

console.log('');
if (failures > 0) { console.error(failures + ' verificacion(es) fallaron.'); process.exit(1); }
console.log('Todas las verificaciones del panel del administrador pasaron.');
