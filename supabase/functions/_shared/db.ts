// Calls ArmoryPal's bot_* RPCs through PostgREST with the secret key. A tiny
// fetch wrapper (rather than supabase-js) keeps _shared free of imports, so
// Vitest can run it and tests can inject a fake.

export type RpcError = { code: string; message: string };
export type RpcResult<T> = { data: T; error: null } | { data: null; error: RpcError };
export type Rpc = <T = unknown>(name: string, args: Record<string, unknown>) => Promise<RpcResult<T>>;

export function createRpc(opts: { url: string; secretKey: string; fetch?: typeof fetch }): Rpc {
  const doFetch = opts.fetch ?? fetch;
  return async <T>(name: string, args: Record<string, unknown>): Promise<RpcResult<T>> => {
    let res: Response;
    try {
      res = await doFetch(`${opts.url}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: opts.secretKey, Authorization: `Bearer ${opts.secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
    } catch {
      return { data: null, error: { code: "network", message: "network" } };
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const err = (body ?? {}) as { code?: string; message?: string };
      // SQL raises the rule code as the message (e.g. 'discord_not_linked').
      return { data: null, error: { code: err.code ?? String(res.status), message: err.message ?? `http_${res.status}` } };
    }
    return { data: body as T, error: null };
  };
}
