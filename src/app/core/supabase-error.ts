// Los errores que devuelve supabase-js (PostgrestError, AuthError, FunctionsError) tienen
// un campo "message" pero NO son instancias de Error -- si se relanzan tal cual, cualquier
// catch de la forma "error instanceof Error ? error.message : fallback" (el patron usado en
// toda la app) los descarta y muestra el mensaje generico, perdiendo el motivo real que la
// base de datos ya devolvio (por ejemplo, el texto de una regla de reserva violada).
export function asError(error: { message: string }): Error {
  return new Error(error.message);
}
