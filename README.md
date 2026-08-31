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

   `http://localhost:4200` debería mostrar "Conectado a Supabase correctamente". Si dice "Supabase no configurado", revisá el paso 3.

## Scripts

| Comando         | Qué hace                                   |
| --------------- | ------------------------------------------- |
| `npm start`     | Servidor de desarrollo (`ng serve`)         |
| `npm run build` | Build de producción en `dist/`              |
| `npm test`      | Tests unitarios (Vitest)                    |

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
