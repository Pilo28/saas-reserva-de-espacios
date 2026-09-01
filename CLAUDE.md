# Reserva de Espacios

SaaS B2B para administradores de edificios/consorcios: automatiza la reserva de espacios
comunes (quinchos, SUM, parrillas, canchas, etc.). El objetivo del producto **no** es ser
"otro calendario de reservas" — es reducir al mínimo la intervención manual del
administrador. Los vecinos se autogestionan (ven disponibilidad, reservan, cancelan, ven
quién ocupa qué); el admin solo interviene ante una excepción real.

## Stack

- **Angular 22**, standalone components (sin NgModules), `@angular/build:application`
  (esbuild), señales (`signal`) para estado, `NonNullableFormBuilder` para forms reactivos.
- **Tailwind CSS v4**.
- **Supabase**: Postgres + Auth + Row Level Security + Edge Functions (Deno). Es la única
  fuente de verdad de datos y de autorización — no hay backend propio.
- **Vercel**: deploy como SPA estática (ver `vercel.json`, rewrite de todas las rutas a
  `index.html`).
- **Vitest** para tests unitarios + scripts Node standalone (`scripts/*.mjs`) que prueban
  RLS y lógica de negocio **en vivo** contra el proyecto Supabase real (no son mocks).

## Supabase

- Project ref: `iwjbjufjsotvpwctmolo` — URL `https://iwjbjufjsotvpwctmolo.supabase.co`.
- **Un solo proyecto Supabase (plan Free) para desarrollo y producción** — no hay staging
  separado. El anon/publishable key es público por diseño (protegido por RLS) y ya vive en
  `src/environments/environment.ts` y `environment.development.ts`.
- **Nunca commitear la DB password, la service_role key, ni el Personal Access Token del
  MCP de Supabase.** Esos viven solo en `SUPABASE.local.md` (gitignorado, no existe en un
  clon nuevo) o en las secrets del dashboard de Supabase / Vercel. Si hacen falta para
  desarrollar (por ejemplo para correr los scripts `test:*`), pedírselos al usuario — no
  están en este repo a propósito.
- **Migraciones** en `supabase/migrations/` (`YYYYMMDDHHMMSS_descripcion.sql`). No hay CLI
  de Supabase instalado en el entorno habitual de desarrollo (ni MCP server de Supabase
  disponible desde Claude Code): cada migración nueva la aplica el usuario a mano, pegándola
  en el SQL Editor del dashboard de Supabase. No dar una fase por terminada sin que el
  usuario confirme que la aplicó, y sin correr los tests en vivo relevantes después.
- **Edge Functions** en `supabase/functions/` (hoy: `invite-user`, que manda el mail de
  invitación usando el mailer default de Supabase vía `auth.admin.inviteUserByEmail` /
  `resetPasswordForEmail`). Tampoco se pueden deployar desde Claude Code — el usuario las
  deploya a mano desde el dashboard (Edge Functions → pegar código → Deploy), y configura
  los secrets necesarios ahí mismo (hoy: `SITE_URL`).
- No intentar pegarle a la Management API de Supabase con el PAT para saltarse estas
  limitaciones (aplicar SQL, deployar funciones, etc.) — el clasificador de seguridad de la
  sesión de Claude Code lo bloquea, y con razón: es una acción de alto impacto con un
  secreto de por medio.

## Cómo correr y probar

- `npm start` — dev server (usa `environment.development.ts`).
- `npm run build` — build de producción (usa `environment.ts`, que tiene las credenciales
  reales, no placeholders — ver la Fase 11 más abajo, ese archivo estuvo vacío desde el
  commit inicial y rompía el deploy).
- `npm run test` — tests unitarios (Vitest), rápidos, no tocan Supabase.
- `npm run test:rls`, `test:reservations`, `test:rules`, `test:dashboard`,
  `test:notifications`, `test:permissions`, `test:invitations` — scripts en `scripts/*.mjs`
  que crean y borran usuarios/edificios de prueba reales contra Supabase. Requieren
  `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` como variables de
  entorno (pedirle los valores al usuario). **Correr todos los que apliquen después de
  cualquier cambio de RLS, triggers o policies** — la lectura manual del SQL no alcanza,
  varios bugs reales de este proyecto solo aparecieron probando en vivo (ver abajo).

## Convenciones y lecciones aprendidas

- **RLS y recursión**: toda función helper usada dentro de una policy (`is_admin_of`,
  `is_member_of`, `shares_building_with`, etc.) que consulte una tabla protegida por RLS
  —sea la misma tabla que protege la policy, sea OTRA— debe ser
  `security definer stable set search_path = public`. Ya hubo dos bugs reales por esto:
  uno de recursión infinita (`fix_rls_helper_recursion.sql`, Fase 3) y otro más sutil de
  visibilidad silenciosa (`20260901151500_fix_profiles_shared_building_recursion.sql`,
  Fase 11.5: un `exists (select ... from building_members ...)` escrito a mano dentro de una
  policy de `profiles` quedaba sujeto a la policy de `building_members`, que un resident no
  puede leer para filas ajenas — la policy fallaba en silencio, sin error, para ese caso).
- **Anti-doble-reserva**: lo garantiza la base de datos, no la app — un
  `exclude using gist (space_id with =, tstzrange(starts_at, ends_at, '[)') with &&)` sobre
  `reservations` (ver Fase 6). Cualquier regla de negocio nueva sobre reservas (límites,
  aprobaciones, etc.) debería seguir el mismo criterio: trigger/constraint en la base, no
  solo validación en el frontend.
- **Servicios Angular** (`src/app/core/*.service.ts`): un servicio por dominio, inyectados
  con `inject()`. Cuando hace falta el nombre de un usuario y no hay FK de PostgREST directa
  entre esa tabla y `profiles` (por ejemplo `reservations.user_id` y `building_members.user_id`
  apuntan a `auth.users`, no a `profiles`), se hace un segundo `select().in('id', userIds)` a
  mano y se mergea en el cliente — no hay embeds automáticos ahí.
- **Componentes**: standalone, `templateUrl` a un `.html` separado, control flow moderno
  (`@if`, `@for`). Estilo Tailwind consistente: tarjetas
  `rounded-xl border border-slate-200 bg-white p-* shadow-sm`, botón primario
  `bg-teal-700 hover:bg-teal-800 text-white`, inputs con foco
  `focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600`.
- **Commits**: mensajes en español, sin trailer `Co-Authored-By` ni ninguna mención de
  Claude/Claude Code/Anthropic (pedido explícito del usuario — sí se permite que este mismo
  archivo `CLAUDE.md` esté commiteado, es la única excepción). En PowerShell, evitar
  comillas dobles dentro de un mensaje de commit multilínea (`git commit -m @'...'@`) — rompe
  el parseo del heredoc y separa el texto en pathspecs sueltos.

## Forma de trabajo pedida por el usuario

Se avanza por fases pequeñas, confirmadas una por una — no implementar todo de una:

1. **Antes de programar**: explicar qué se va a construir, qué archivos se van a tocar, las
   decisiones importantes (sobre todo las que tocan seguridad/RLS/privacidad) y los riesgos.
   Pedir confirmación si hay una decisión arquitectónica relevante — no asumir.
2. Implementar, reutilizando lo que ya existe (no reescribir código existente sin necesidad).
3. **Al cerrar la fase**: correr build, tests unitarios, y las suites `test:*` en vivo que
   apliquen. Commitear y pushear. Proponer el siguiente paso — no encadenar fases solo.
4. Pensar explícitamente, para cada tabla/feature nueva: "¿puede un usuario de otro edificio
   acceder a esto?" — si la respuesta es potencialmente sí, corregir antes de seguir.

## Estado del producto

MVP funcional de punta a punta: registro/login → crear edificio (quien lo crea queda admin
automáticamente) → invitar vecinos por mail (sin proveedor de email propio todavía — usa el
mailer default de Supabase vía la Edge Function `invite-user`, con límite de envíos por hora
bastante bajo) → crear espacios comunes → configurar horarios y reglas de reserva → reservar
→ cancelar → panel de administrador (resumen del día, ocupación, alertas) → notificaciones
web in-app (creación/cancelación de reserva, recordatorio de reserva próxima). Cualquier
vecino ve el nombre de quien ocupa un horario reservado y de otros miembros de su edificio
(decisión explícita del usuario, revierte una privacidad más estricta de fases anteriores).

Fases del roadmap original (15, definidas antes de escribir código) + una fase extra no
prevista (alta de vecinos, faltaba por completo): Fase 0 (arquitectura) a Fase 11.5 (alta de
vecinos por invitación) completas — ver `git log --oneline` para el detalle fase por fase
(cada fase es uno o más commits con el prefijo "Fase N:"). Pendientes del roadmap original:
Fase 12 (beta con un edificio real, en curso), 13 (WhatsApp), 14 (incidentes), 15 (IA).

### Pendientes conocidos

- **Proveedor de email propio** (Resend u otro, vía SMTP en Supabase Authentication → Email
  → SMTP Settings): pospuesto a pedido del usuario. El mailer default alcanza para probar de
  a poco, pero se agota rápido invitando a varios vecinos reales de una — retomar esto antes
  de una invitación masiva real.
- Sin UI de gestión standalone de `units` (piso/depto) fuera del flujo de invitar/editar un
  vecino — se crean "al paso" (find-or-create) desde ahí, no hay una pantalla de "unidades".
- Notificaciones por WhatsApp: no implementadas (el brief original las preveía como fase
  futura, después del email).
