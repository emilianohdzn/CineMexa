// Interfaz mínima de base de datos que cumplen PGlite (tests) y node-postgres / postgres.js (producción).
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Conexión de producción (postgres.js) para collectors, jobs y siembras.
 * Los llamadores mandan las columnas json/jsonb ya serializadas con JSON.stringify (así lo exige
 * PGlite en las pruebas). Con sentencias preparadas postgres.js conoce el tipo del parámetro y lo
 * volvería a serializar, guardando un string JSON en vez del objeto: por eso el texto pasa tal cual.
 */
export async function openPostgres(url: string): Promise<{ db: Db; end: () => Promise<void> }> {
  const { default: postgres } = await import("postgres");
  const passthrough = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
  const sql = postgres(url, {
    max: 1,
    types: {
      json: { to: 114, from: [114], serialize: passthrough, parse: JSON.parse },
      jsonb: { to: 3802, from: [3802], serialize: passthrough, parse: JSON.parse },
    },
  });
  return {
    db: { query: async (q, params = []) => ({ rows: (await sql.unsafe(q, params as never[])) as never[] }) },
    end: () => sql.end(),
  };
}

/** Ejecuta `fn` dentro de una transacción. */
export async function inTransaction<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    const result = await fn();
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
