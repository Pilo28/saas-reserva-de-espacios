// Prueba en vivo de la alta de vecinos por invitacion (sin email real): el admin carga un
// mail, y esa persona se suma al edificio sola la proxima vez que inicia sesion con ese mail
// (sea porque ya tenia cuenta, o porque se registra despues de ser invitada).
//
// Requiere las mismas tres variables que test-rls-isolation.mjs (ver SUPABASE.local.md):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Uso: correr contra un proyecto de DESARROLLO. Este script inserta y borra filas reales.
//
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:invitations

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
  const email = `invite-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'test-password-123';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, anon);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { client, userId: signIn.data.user.id, email, password };
}

async function signIn(email, password) {
  const client = createClient(url, anon);
  const res = await client.auth.signInWithPassword({ email, password });
  if (res.error) throw res.error;
  return { client, userId: res.data.user.id };
}

console.log('setup...');
const a1 = await newUser('a1'); // admin del edificio A
const b1 = await newUser('b1'); // admin de otro edificio, ya registrado de antemano
const c1 = await newUser('c1'); // admin de un tercer edificio, ajeno a todo esto

const bA = await a1.client.from('buildings').insert({ name: 'Edif Invite A ' + Date.now(), created_by: a1.userId }).select().single();
if (bA.error) throw bA.error;
const bC = await c1.client.from('buildings').insert({ name: 'Edif Invite C ' + Date.now(), created_by: c1.userId }).select().single();
if (bC.error) throw bC.error;

const futureEmail = `invite-test-future-${Date.now()}@example.com`;
const futurePassword = 'test-password-123';

console.log('\n1. invitar a alguien que TODAVIA no tiene cuenta...');
const inv1 = await a1.client.from('building_invitations').insert({ building_id: bA.data.id, email: futureEmail, role: 'resident', invited_by: a1.userId }).select().single();
inv1.error ? fail('el admin deberia poder crear la invitacion', JSON.stringify(inv1.error)) : ok('se crea la invitacion pendiente para ' + futureEmail);

console.log('\n2. esa persona se registra y la invitacion se resuelve sola...');
const created = await admin.auth.admin.createUser({ email: futureEmail, password: futurePassword, email_confirm: true });
if (created.error) throw created.error;
const future = await signIn(futureEmail, futurePassword);

const acceptRpc = await future.client.rpc('accept_pending_invitations');
acceptRpc.error ? fail('accept_pending_invitations no deberia fallar', JSON.stringify(acceptRpc.error)) : ok('la persona invitada llama accept_pending_invitations sin error');

const membership = await admin.from('building_members').select('role').eq('building_id', bA.data.id).eq('user_id', future.userId).maybeSingle();
membership.data?.role === 'resident' ? ok('quedo como miembro (resident) del edificio A') : fail('deberia haberse unido como resident', JSON.stringify(membership));

const invAfter = await a1.client.from('building_invitations').select('status').eq('id', inv1.data.id).single();
invAfter.data?.status === 'accepted' ? ok('la invitacion paso a estado "accepted"') : fail('la invitacion deberia estar accepted', JSON.stringify(invAfter));

console.log('\n3. invitar a alguien que YA tiene cuenta (B1, admin de otro edificio)...');
const inv2 = await a1.client.from('building_invitations').insert({ building_id: bA.data.id, email: b1.email, role: 'resident', invited_by: a1.userId }).select().single();
if (inv2.error) throw inv2.error;

const b1Accepts = await b1.client.rpc('accept_pending_invitations');
if (b1Accepts.error) throw b1Accepts.error;
const b1Membership = await admin.from('building_members').select('role').eq('building_id', bA.data.id).eq('user_id', b1.userId).maybeSingle();
b1Membership.data?.role === 'resident' ? ok('B1 se sumo al edificio A ademas de seguir siendo admin del suyo') : fail('B1 deberia haberse unido a A', JSON.stringify(b1Membership));

console.log('\n4. un vecino (no admin) no puede invitar a nadie...');
const residentInvites = await future.client.from('building_invitations').insert({ building_id: bA.data.id, email: 'quien-sea@example.com', role: 'resident', invited_by: future.userId });
residentInvites.error ? ok('el vecino recien sumado no puede crear invitaciones') : fail('un resident no deberia poder invitar gente');

console.log('\n5. no se puede duplicar una invitacion pendiente para el mismo mail...');
const dup = await a1.client.from('building_invitations').insert({ building_id: bA.data.id, email: 'duplicado@example.com', role: 'resident', invited_by: a1.userId }).select().single();
const dup2 = await a1.client.from('building_invitations').insert({ building_id: bA.data.id, email: 'DUPLICADO@example.com', role: 'resident', invited_by: a1.userId });
dup.error ? fail('la primera invitacion a duplicado@ deberia haberse creado', JSON.stringify(dup.error)) : ok('primera invitacion a duplicado@example.com creada');
dup2.error ? ok('la segunda invitacion pendiente al mismo mail (distinto casing) es rechazada') : fail('no deberia permitir dos invitaciones pendientes al mismo mail');

console.log('\n6. cancelar una invitacion pendiente...');
const cancel = await a1.client.from('building_invitations').update({ status: 'cancelled' }).eq('id', dup.data.id).select();
cancel.error || cancel.data.length !== 1 ? fail('el admin deberia poder cancelar la invitacion', JSON.stringify(cancel)) : ok('el admin cancela la invitacion pendiente');

console.log('\n7. aislamiento: el admin de OTRO edificio no ve ni toca las invitaciones de A...');
const c1SeesInvites = await c1.client.from('building_invitations').select('id').eq('building_id', bA.data.id);
c1SeesInvites.data?.length === 0 ? ok('C1 (admin de otro edificio) no ve las invitaciones de A') : fail('C1 no deberia ver invitaciones de A', JSON.stringify(c1SeesInvites));

const c1CancelsInvite = await c1.client.from('building_invitations').update({ status: 'cancelled' }).eq('id', inv2.data.id).select();
c1CancelsInvite.data?.length === 0 ? ok('C1 no puede cancelar una invitacion del edificio A') : fail('C1 no deberia poder modificar invitaciones de A', JSON.stringify(c1CancelsInvite));

console.log('\n8. piso y depto quedan asignados al aceptar la invitacion...');
const unit3B = await a1.client.from('units').insert({ building_id: bA.data.id, floor: '3', label: 'B' }).select().single();
if (unit3B.error) throw unit3B.error;

const d1 = await newUser('d1');
const invWithUnit = await a1.client.from('building_invitations').insert({ building_id: bA.data.id, email: d1.email, role: 'resident', unit_id: unit3B.data.id, invited_by: a1.userId }).select().single();
if (invWithUnit.error) throw invWithUnit.error;

const d1Accepts = await d1.client.rpc('accept_pending_invitations');
if (d1Accepts.error) throw d1Accepts.error;

const d1Membership = await admin.from('building_members').select('unit_id').eq('building_id', bA.data.id).eq('user_id', d1.userId).maybeSingle();
d1Membership.data?.unit_id === unit3B.data.id ? ok('D1 quedo asignado al Piso 3 Depto B') : fail('D1 deberia tener el unit_id de la invitacion', JSON.stringify(d1Membership));

console.log('\nlimpiando...');
await admin.from('buildings').delete().in('id', [bA.data.id, bC.data.id]);
await admin.auth.admin.deleteUser(a1.userId);
await admin.auth.admin.deleteUser(b1.userId);
await admin.auth.admin.deleteUser(c1.userId);
await admin.auth.admin.deleteUser(future.userId);
await admin.auth.admin.deleteUser(d1.userId);

console.log('');
if (failures > 0) { console.error(failures + ' verificacion(es) fallaron.'); process.exit(1); }
console.log('Todas las verificaciones de invitaciones pasaron.');
