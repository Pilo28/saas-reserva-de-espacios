// Prueba de aislamiento multi-tenant contra un proyecto Supabase real (no un mock).
// Crea dos usuarios y dos edificios reales, y verifica que el usuario del edificio A
// no puede leer ni escribir nada del edificio B a traves de la API publica (anon key + RLS).
//
// Requiere tres variables de entorno — NUNCA hardcodear estos valores en este archivo:
//   SUPABASE_URL              - URL pública del proyecto
//   SUPABASE_ANON_KEY         - publishable/anon key (simula a los usuarios reales)
//   SUPABASE_SERVICE_ROLE_KEY - SOLO para crear/borrar los usuarios de prueba sin
//                                mandar emails de confirmación. Nunca se usa para leer
//                                ni escribir buildings/units/members: eso lo hacen los
//                                clientes de A y B, con la anon key, para que la prueba
//                                exija exactamente lo mismo que exige la app real.
//
// Uso: correr contra un proyecto de DESARROLLO. Este script inserta y borra filas reales.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/test-rls-isolation.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Faltan variables de entorno. Necesitás SUPABASE_URL, SUPABASE_ANON_KEY y ' +
      'SUPABASE_SERVICE_ROLE_KEY (ver SUPABASE.local.md). Nunca contra un proyecto de producción.',
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = Date.now();
let failures = 0;

function ok(description) {
  console.log(`  ok   ${description}`);
}

function fail(description, detail) {
  failures += 1;
  console.error(`  FAIL ${description}`);
  if (detail) console.error(`       ${detail}`);
}

async function createConfirmedUser(label) {
  const email = `rls-isolation-test-${label}-${stamp}@example.com`;
  const password = 'test-password-123';

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  return { client, userId: created.data.user.id };
}

console.log('Preparando usuarios de prueba...');
const userA = await createConfirmedUser('a');
const userB = await createConfirmedUser('b');

console.log('Creando edificios...');
const buildingA = await userA.client
  .from('buildings')
  .insert({ name: `Edificio A ${stamp}`, created_by: userA.userId })
  .select()
  .single();
if (buildingA.error) throw buildingA.error;

const buildingB = await userB.client
  .from('buildings')
  .insert({ name: `Edificio B ${stamp}`, created_by: userB.userId })
  .select()
  .single();
if (buildingB.error) throw buildingB.error;

console.log('Verificando aislamiento...');

// A ve su propio edificio, gracias al trigger que lo hizo admin automáticamente.
const aOwnBuilding = await userA.client.from('buildings').select('id').eq('id', buildingA.data.id);
aOwnBuilding.data?.length === 1
  ? ok('A ve su propio edificio')
  : fail('A debería ver su propio edificio', JSON.stringify(aOwnBuilding));

// B no puede ver el edificio de A.
const bReadsA = await userB.client.from('buildings').select('id').eq('id', buildingA.data.id);
bReadsA.data?.length === 0
  ? ok('B no ve el edificio de A (SELECT)')
  : fail('B no debería poder leer el edificio de A', JSON.stringify(bReadsA));

// B no puede actualizar el edificio de A.
const bUpdatesA = await userB.client
  .from('buildings')
  .update({ name: 'hackeado' })
  .eq('id', buildingA.data.id)
  .select();
bUpdatesA.data?.length === 0
  ? ok('B no puede actualizar el edificio de A (UPDATE)')
  : fail('B no debería poder actualizar el edificio de A', JSON.stringify(bUpdatesA));

// B no puede agregarse como miembro del edificio de A.
const bJoinsA = await userB.client
  .from('building_members')
  .insert({ building_id: buildingA.data.id, user_id: userB.userId, role: 'resident' });
bJoinsA.error
  ? ok('B no puede insertarse como miembro del edificio de A (INSERT rechazado)')
  : fail('B no debería poder unirse al edificio de A sin ser invitado');

// B no puede ver la lista de miembros del edificio de A.
const bReadsAMembers = await userB.client
  .from('building_members')
  .select('id')
  .eq('building_id', buildingA.data.id);
bReadsAMembers.data?.length === 0
  ? ok('B no ve los miembros del edificio de A')
  : fail('B no debería ver miembros del edificio de A', JSON.stringify(bReadsAMembers));

// A puede crear una unidad en su propio edificio; B no.
const aCreatesUnit = await userA.client
  .from('units')
  .insert({ building_id: buildingA.data.id, label: '1A' })
  .select();
aCreatesUnit.data?.length === 1
  ? ok('A puede crear unidades en su propio edificio')
  : fail('A debería poder crear unidades en su edificio', JSON.stringify(aCreatesUnit));

const bCreatesUnitInA = await userB.client
  .from('units')
  .insert({ building_id: buildingA.data.id, label: '2B-intruso' });
bCreatesUnitInA.error
  ? ok('B no puede crear unidades en el edificio de A')
  : fail('B no debería poder crear unidades en el edificio de A');

console.log('Limpiando datos de prueba...');
await admin.from('buildings').delete().in('id', [buildingA.data.id, buildingB.data.id]);
await admin.auth.admin.deleteUser(userA.userId);
await admin.auth.admin.deleteUser(userB.userId);

console.log('');
if (failures > 0) {
  console.error(`${failures} verificación(es) fallaron.`);
  process.exit(1);
}
console.log('Todas las verificaciones de aislamiento pasaron.');
