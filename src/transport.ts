import type { ProviderConfig } from './types.ts';

export class RequestError extends Error {
  status: number | undefined;
  parameter: string | undefined;
  constructor(message: string, status?: number, parameter?: string) {
    super(message); this.status = status; this.parameter = parameter;
  }
}
export const object = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
export const string = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 2048;
export const strings = (x: unknown): x is string[] => Array.isArray(x) && x.length <= 256 && x.every(string);
export const number = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
export const date = (x: unknown): x is string => string(x) && /^\d{4}-\d\d-\d\d(?:T.*)?$/.test(x) && Number.isFinite(Date.parse(x));

/** Keep only a recognized rejected parameter, never echoed requests or server text. */
function rejectedParameter(text: string): string | undefined {
  const parameters = ['temperature', 'top_p', 'reasoning_effort', 'output_config.effort', 'effort',
    'response_format', 'output_config.format', 'tool_choice'];
  let message: unknown = text;
  try {
    const root = object(JSON.parse(text));
    const error = root.error === undefined ? root : object(root.error);
    const param = error.param ?? error.parameter;
    // An explicit different parameter takes priority over incidental mentions in the message.
    if (param !== undefined && param !== null) {
      return typeof param === 'string' ? parameters.find(p => param === p || param.startsWith(`${p}.`)) : undefined;
    }
    message = error.message;
  } catch { /* Plain-text errors must start with a parameter-specific rejection. */ }
  if (typeof message !== 'string') return undefined;
  return parameters.find(p => {
    const name = p.replaceAll('.', '\\.');
    const token = `["'\x60]?${name}["'\x60]?(?=\\s|:|$)`;
    return new RegExp(`^(?:unsupported|invalid|unknown|unrecognized)(?: value for)?(?: (?:parameter|field|argument))?[:\\s]+${token}`, 'i').test(message.trim())
      || new RegExp(`^(?:the )?(?:(?:parameter|field|argument) )?${token}(?:\\s+is)?[:\\s]+(?:not supported|unsupported|invalid|not allowed|must be)\\b`, 'i').test(message.trim());
  });
}

/** Config remains private to request closures. Only normalized data leaves the transport. */
export function makeTransport(fetcher: typeof fetch, timeoutMs: number, maxBytes: number) {
  return async (url: URL, headers: Headers, body?: unknown): Promise<unknown> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new RequestError('Request timed out')); }, timeoutMs);
    });
    const work = async () => {
      try {
        const response = await fetcher(url, {
          method: body === undefined ? 'GET' : 'POST', headers, signal: controller.signal,
          redirect: 'error', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const length = Number(response.headers.get('content-length'));
        if (length > maxBytes) { controller.abort(); void response.body?.cancel().catch(() => {}); throw new RequestError('Response too large'); }
        const reader = response.body?.getReader();
        let total = 0;
        const parts: Uint8Array[] = [];
        try {
          if (reader) while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) { controller.abort(); void reader.cancel().catch(() => {}); throw new RequestError('Response too large'); }
            parts.push(value);
          }
        } finally { reader?.releaseLock(); }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) { bytes.set(part, offset); offset += part.length; }
        const text = new TextDecoder().decode(bytes);
        if (!response.ok) {
          // Never expose server error text: gateways can echo credentials, URLs or prompts.
          const parameter = rejectedParameter(text);
          throw new RequestError(`HTTP ${response.status}`, response.status, parameter);
        }
        try { return JSON.parse(text) as unknown; }
        catch { throw new RequestError('Invalid JSON response'); }
      } catch (error) {
        if (error instanceof RequestError) throw error;
        throw new RequestError('Network request failed');
      }
    };
    try { return await Promise.race([work(), timeout]); }
    finally { clearTimeout(timer); }
  };
}
export type Transport = ReturnType<typeof makeTransport>;
export function baseUrl(config: ProviderConfig): URL {
  const defaults = { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com/v1',
    openrouter: 'https://openrouter.ai/api/v1', fireworks: 'https://api.fireworks.ai/v1', 'openai-compatible': '' };
  const url = new URL(config.baseUrl ?? defaults[config.kind]);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid endpoint protocol');
  // Credentials belong in headers, never URL userinfo. Query retained for caller-defined gateways.
  url.username = ''; url.password = ''; url.hash = '';
  return url;
}
export function append(base: URL, path: string): URL {
  const url = new URL(base); url.pathname = `${url.pathname.replace(/\/$/, '')}/${path}`; return url;
}
export function auth(config: ProviderConfig): Headers {
  const headers = new Headers(config.headers);
  headers.set('accept', 'application/json'); headers.set('content-type', 'application/json');
  if (config.kind === 'anthropic') {
    headers.set('anthropic-version', '2023-06-01');
    if (config.apiKey) headers.set('x-api-key', config.apiKey);
  } else if (config.apiKey) headers.set('authorization', `Bearer ${config.apiKey}`);
  return headers;
}
/** Remove secret echoes and URLs before retaining any remotely supplied string. */
export function makeSanitizer(providers: ProviderConfig[]) {
  const secrets = new Set<string>();
  for (const p of providers) {
    if (p.apiKey) secrets.add(p.apiKey);
    for (const value of Object.values(p.headers ?? {})) {
      if (value) secrets.add(value);
      if (/^Bearer /i.test(value)) secrets.add(value.slice(7));
    }
    try {
      const url = new URL(p.baseUrl ?? 'https://invalid.local');
      for (const value of [url.username, url.password, ...url.searchParams.values()]) {
        if (value) { secrets.add(value); secrets.add(decodeURIComponent(value)); }
      }
    } catch { /* Invalid config is reported as a source failure. */ }
  }
  return (value: string): string => {
    for (const secret of secrets) if (value.includes(secret) || value.includes(encodeURIComponent(secret))) return '[redacted]';
    return value.replace(/https?:\/\/[^\s"<>]+/gi, raw => { try { return new URL(raw).hostname; } catch { return '[url]'; } });
  };
}
