// Fase 10 - refuerzo de testing: matriz de permisos que las suites anteriores no cubrian.
// Las suites de las fases 3/6/7/8/9 prueban aislamiento ENTRE edificios (A no ve/toca nada
// de B). Lo que faltaba probar en vivo es permisos DENTRO del mismo edificio: un vecino
// (resident, no admin) no deberia poder administrar espacios/horarios/reglas/bloqueos aunque
// sea miembro legitimo de ese edificio. Tambien suma un chequeo minimo de autenticacion.
//
// Requiere las mismas tres variables que test-rls-isolation.mjs (ver SUPABASE.local.md):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Uso: correr contra un proyecto de DESARROLLO. Este script inserta y borra filas reales.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:permissions

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
  const email = `perms-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'test-password-123';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, anon);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { client, userId: signIn.data.user.id, email, password };
}

console.log('setup...');
const a1 = await newUser('a1'); // admin del edificio A
const a2 = await newUser('a2'); // vecino (resident) del edificio A
const b1 = await newUser('b1'); // admin de otro edificio

const bA = await a1.client.from('buildings').insert({ name: 'Edif Permisos A ' + Date.now(), created_by: a1.userId }).select().single();
if (bA.error) throw bA.error;

const addMember = await admin.from('building_members').insert({ building_id: bA.data.id, user_id: a2.userId, role: 'resident' });
if (addMember.error) throw addMember.error;

const space = await a1.client.from('spaces').insert({ building_id: bA.data.id, name: 'Quincho' }).select().single();
if (space.error) throw space.error;

console.log('\n0. autenticacion...');
const anonClient = createClient(url, anon);
const wrongPassword = await anonClient.auth.signInWithPassword({ email: a1.email, password: 'password-incorrecta' });
wrongPassword.error ? ok('login con contraseña incorrecta es rechazado') : fail('deberia haber rechazado la contraseña incorrecta');

console.log('\n1. un vecino (resident) no puede administrar espacios de SU PROPIO edificio...');
const a2CreatesSpace = await a2.client.from('spaces').insert({ building_id: bA.data.id, name: 'SUM intruso' });
a2CreatesSpace.error ? ok('resident no puede crear un espacio') : fail('un resident no deberia poder crear espacios');

const a2UpdatesSpace = await a2.client.from('spaces').update({ name: 'hackeado' }).eq('id', space.data.id).select();
a2UpdatesSpace.data?.length === 0 ? ok('resident no puede editar el espacio del admin') : fail('un resident no deberia poder editar espacios', JSON.stringify(a2UpdatesSpace));

const a2DeletesSpace = await a2.client.from('spaces').delete().eq('id', space.data.id).select();
a2DeletesSpace.data?.length === 0 ? ok('resident no puede borrar el espacio del admin') : fail('un resident no deberia poder borrar espacios', JSON.stringify(a2DeletesSpace));

console.log('\n2. un vecino no puede tocar horarios, reglas ni bloqueos de su edificio...');
const a2CreatesSchedule = await a2.client.from('space_schedules').insert({ building_id: bA.data.id, space_id: space.data.id, weekday: 1, opens_at: '09:00', closes_at: '20:00' });
a2CreatesSchedule.error ? ok('resident no puede crear un horario') : fail('un resident no deberia poder crear horarios');

const a2CreatesRules = await a2.client.from('space_rules').insert({ space_id: space.data.id, building_id: bA.data.id, max_active_reservations_per_user: 99 });
a2CreatesRules.error ? ok('resident no puede crear/editar reglas de reserva') : fail('un resident no deberia poder tocar space_rules');

const a2CreatesBlock = await a2.client.from('blocked_periods').insert({ building_id: bA.data.id, space_id: space.data.id, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600_000).toISOString(), created_by: a2.userId });
a2CreatesBlock.error ? ok('resident no puede crear un bloqueo de horario') : fail('un resident no deberia poder crear blocked_periods');

console.log('\n3. un vecino SI puede leer lo anterior (no esta sobre-restringido)...');
const a2ReadsSpace = await a2.client.from('spaces').select('id').eq('id', space.data.id);
a2ReadsSpace.data?.length === 1 ? ok('resident puede ver el espacio de su edificio') : fail('un resident deberia poder ver los espacios de su edificio', JSON.stringify(a2ReadsSpace));

console.log('\n4. un admin de OTRO edificio no puede tocar ni ver nada del edificio A...');
const b1ReadsSpace = await b1.client.from('spaces').select('id').eq('id', space.data.id);
b1ReadsSpace.data?.length === 0 ? ok('B1 (admin de otro edificio) no ve el espacio de A') : fail('B1 no deberia ver espacios del edificio A', JSON.stringify(b1ReadsSpace));

const b1UpdatesSpace = await b1.client.from('spaces').update({ name: 'hackeado-b' }).eq('id', space.data.id).select();
b1UpdatesSpace.data?.length === 0 ? ok('B1 no puede editar el espacio de A') : fail('B1 no deberia poder editar espacios de A', JSON.stringify(b1UpdatesSpace));

const b1CreatesSpaceInA = await b1.client.from('spaces').insert({ building_id: bA.data.id, name: 'intruso-b' });
b1CreatesSpaceInA.error ? ok('B1 no puede crear un espacio en el edificio A') : fail('B1 no deberia poder crear espacios en el edificio A');

const b1CreatesUnitInA = await b1.client.from('units').insert({ building_id: bA.data.id, label: '9Z-intruso' });
b1CreatesUnitInA.error ? ok('B1 no puede crear una unidad en el edificio A') : fail('B1 no deberia poder crear unidades en el edificio A');

console.log('\n5. el admin real SI puede hacer todo lo anterior...');
const a1CreatesSchedule = await a1.client.from('space_schedules').insert({ building_id: bA.data.id, space_id: space.data.id, weekday: 1, opens_at: '09:00', closes_at: '20:00' }).select().single();
a1CreatesSchedule.error ? fail('el admin deberia poder crear un horario', JSON.stringify(a1CreatesSchedule.error)) : ok('el admin crea un horario para su espacio');

const a1CreatesBlock = await a1.client.from('blocked_periods').insert({ building_id: bA.data.id, space_id: space.data.id, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600_000).toISOString(), created_by: a1.userId, reason: 'mantenimiento' }).select().single();
a1CreatesBlock.error ? fail('el admin deberia poder crear un bloqueo', JSON.stringify(a1CreatesBlock.error)) : ok('el admin crea un bloqueo de mantenimiento');

console.log('\nlimpiando...');
await admin.from('buildings').delete().eq('id', bA.data.id);
await admin.auth.admin.deleteUser(a1.userId);
await admin.auth.admin.deleteUser(a2.userId);
await admin.auth.admin.deleteUser(b1.userId);

console.log('');
if (failures > 0) { console.error(failures + ' verificacion(es) fallaron.'); process.exit(1); }
console.log('Todas las verificaciones de permisos pasaron.');
