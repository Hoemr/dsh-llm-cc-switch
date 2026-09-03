// dsh-llm-cc-switch: lazy `node:sqlite` loader.
//
// `node:sqlite` is a Node built-in but vite-node (and certain bundler
// pre-pass modes) strip the "node:" prefix and try to resolve a bare
// "sqlite" spec, which then fails the load. Hiding the import behind
// an async factory keeps the rest of the module graph free of the
// literal spec until something actually needs to read a database.

/** @returns {Promise<typeof import("node:sqlite").DatabaseSync>} */
export async function loadDatabaseSync() {
  if (typeof globalThis.__ccSwitchDatabaseSync === "function") {
    return globalThis.__ccSwitchDatabaseSync;
  }
  const mod = await import("node:sqlite");
  const cls = mod.DatabaseSync;
  globalThis.__ccSwitchDatabaseSync = cls;
  return cls;
}

/**
 * Synchronous fast path: returns the cached class after the first async
 * load resolved. Throws when nothing has loaded yet. Callers that want
 * to use this in a sync code path should kick off `loadDatabaseSync()`
 * at plugin boot.
 */
export function cachedDatabaseSync() {
  if (typeof globalThis.__ccSwitchDatabaseSync === "function") {
    return globalThis.__ccSwitchDatabaseSync;
  }
  throw new Error(
    "dsh-llm-cc-switch: node:sqlite is not loaded yet; call loadDatabaseSync() during plugin boot.",
  );
}
