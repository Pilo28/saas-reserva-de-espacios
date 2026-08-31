# Reserva de Espacios

SaaS B2B para administradores de edificios: reservas de espacios comunes (quinchos, SUM, parrillas) sin depender de WhatsApp.

Angular 22 (standalone, zoneless, Tailwind CSS) + Supabase (Postgres, Auth, Storage). Deploy en Vercel.

## Setup local

1. Instalar dependencias:

   ```bash
   npm install
   ```

2. Crear un proyecto en [supabase.com](https://supabase.com) (podés crear dos: uno de desarrollo y otro de producción, o usar el mismo al principio).

3. Completar `src/environments/environment.development.ts` con los valores de **Project Settings → API** de tu proyecto Supabase:

   ```ts
   export const environment = {
     production: false,
     supabaseUrl: 'https://xxxxxxxx.supabase.co',
     supabaseAnonKey: 'eyJ...',
   };
   ```

   La `anonKey` es pública por diseño (queda protegida por Row Level Security) — no es un secreto, pero igual conviene usar un proyecto Supabase distinto para desarrollo y producción.

4. Levantar el servidor de desarrollo:

   ```bash
   npm start
   ```

   `http://localhost:4200` debería redirigir a `/login`.

## Scripts

| Comando            | Qué hace                                                    |
| ------------------- | ------------------------------------------------------------ |
| `npm start`         | Servidor de desarrollo (`ng serve`)                          |
| `npm run build`     | Build de producción en `dist/`                                |
| `npm test`          | Tests unitarios (Vitest)                                     |
| `npm run test:rls`  | Verifica aislamiento multi-tenant contra un proyecto real (ver abajo) |

## Base de datos

Las migraciones viven en `supabase/migrations/`. Para aplicarlas a un proyecto:

```bash
npx supabase login
npx supabase link --project-ref <ref-del-proyecto>
npx supabase db push
```

### Test de aislamiento multi-tenant

`scripts/test-rls-isolation.mjs` crea dos usuarios y dos edificios reales contra un
proyecto Supabase, y verifica que uno no puede leer ni escribir nada del otro a través
de la API pública (RLS). Corre contra un proyecto de **desarrollo**, nunca producción:

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:rls
```

Las tres variables están en `SUPABASE.local.md` (no versionado). La service role key
solo se usa para crear/borrar los usuarios de prueba sin mandar emails reales — todas
las verificaciones de acceso se hacen con la anon key, igual que la app real.

## Deploy

- **Producción**: completar `src/environments/environment.ts` con los valores del proyecto Supabase de **producción** antes de buildear, o configurarlos como variables de entorno en Vercel si se automatiza el build (ver Fase 12 del roadmap).
- El build genera un sitio estático en `dist/reserva-espacios/browser` — no requiere SSR ni un servidor Node corriendo.

## Estructura

```
src/app/
  core/               servicios transversales (Supabase, auth, etc.)
  app.ts / app.html    shell raíz de la aplicación
src/environments/      configuración por entorno (no versionar claves reales de producción)
```
