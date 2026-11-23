// Interfaz mínima de base de datos que cumplen PGlite (tests) y node-postgres / postgres.js (producción).
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
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
