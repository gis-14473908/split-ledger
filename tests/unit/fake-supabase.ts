// A tiny recording stand-in for the Supabase query builder, enough for data-layer tests.
type Call = { table: string; op: string; args: unknown[] };

export function recordingSupabase(results: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const uploads: { bucket: string; path: string }[] = [];

  function builder(table: string) {
    const chain: Record<string, unknown> = {};
    const record = (op: string) => (...args: unknown[]) => {
      calls.push({ table, op, args });
      return chain;
    };
    for (const op of ["select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "is", "not", "order", "limit", "gte", "lt", "lte", "or"]) {
      chain[op] = record(op);
    }
    const result = () => (results[table] ?? { data: [], error: null }) as { data: unknown; error: unknown };
    chain.single = () => Promise.resolve(results[`${table}.single`] ?? result());
    chain.maybeSingle = chain.single;
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  }

  return {
    calls,
    rpcCalls,
    uploads,
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(results[`rpc.${fn}`] ?? { data: null, error: null });
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string) => {
          uploads.push({ bucket, path });
          return Promise.resolve({ data: { path }, error: null });
        },
      }),
    },
  };
}
