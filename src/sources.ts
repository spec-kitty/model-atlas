import type { CatalogConfig, ProviderConfig, SourceSnapshot, StoredModel } from './types.ts';
import type { Transport } from './transport.ts';
import { append, auth, baseUrl, object, string } from './transport.ts';
import { normalize, mergeClaims } from './normalize.ts';

export async function loadProvider(config: ProviderConfig, request: Transport, at: string, clean: (s: string) => string) {
  const base = baseUrl(config); const headers = auth(config);
  const source = `provider:${config.id}`;
  const path = config.kind === 'anthropic' ? 'v1/models' : config.kind === 'fireworks' ? `accounts/${encodeURIComponent(config.account ?? 'fireworks')}/models` : 'models';
  const url = append(base, path);
  if (config.kind === 'anthropic') url.searchParams.set('limit', '1000');
  if (config.kind === 'fireworks') url.searchParams.set('pageSize', '200');
  const models = new Map<string, StoredModel>(); let skipped = 0;
  const absorb = (items: unknown[], via: string) => {
    for (const item of items) {
      const model = normalize(item, { source: 'endpoint', via, at, provider: config.id, kind: config.kind, clean });
      if (!model) { skipped++; continue; }
      const previous = models.get(model.id);
      if (previous) mergeClaims(previous.claims, model.claims); else models.set(model.id, model);
    }
  };
  const seen = new Set<string>();
  for (let page = 0; ; page++) {
    if (page >= 100) throw new Error('Pagination limit exceeded');
    const r = object(await request(url, headers));
    const items = r.data ?? r.models;
    if (!Array.isArray(items)) throw new Error('Invalid listing shape');
    absorb(items, `${config.id}:/${path}`);
    let cursor: unknown;
    if (config.kind === 'anthropic' && r.has_more === true) {
      cursor = r.last_id;
      if (!string(cursor)) throw new Error('Invalid pagination cursor');
    }
    if (config.kind === 'fireworks' && r.nextPageToken !== undefined && r.nextPageToken !== '') {
      cursor = r.nextPageToken;
      if (!string(cursor)) throw new Error('Invalid pagination cursor');
    }
    if (cursor === undefined) break;
    if (!string(cursor) || seen.has(cursor)) throw new Error('Repeated pagination cursor');
    seen.add(cursor); url.searchParams.set(config.kind === 'anthropic' ? 'after_id' : 'pageToken', cursor);
  }
  if (config.kind === 'openai-compatible') {
    try {
      const r = object(await request(new URL('/model/info', base), headers));
      if (Array.isArray(r.data)) absorb(r.data, `${config.id}:/model/info`);
    } catch { /* Opportunistic enrichment: failure is deliberately silent. */ }
  }
  const state: SourceSnapshot = { source, kind: 'provider', at, hostname: base.hostname, models: [...models.values()] };
  return { state, skipped };
}
export async function loadCatalog(config: CatalogConfig, request: Transport, at: string, clean: (s: string) => string) {
  const url = new URL(config.kind === 'models.dev' ? 'https://models.dev/api.json' : 'https://openrouter.ai/api/v1/models');
  const raw = await request(url, new Headers({ accept: 'application/json' }));
  const models: StoredModel[] = []; let skipped = 0;
  const add = (raw: unknown, provider: string, key: string) => {
    const model = normalize(raw, { source: 'catalog', via: config.id, at, provider: clean(provider), clean }, true);
    if (!model) { skipped++; return; }
    model.catalogKey = clean(key); models.push(model);
  };
  if (config.kind === 'models.dev') {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid catalog shape');
    for (const [provider, value] of Object.entries(object(raw))) {
      const entries = object(value).models;
      if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) { skipped++; continue; }
      for (const [id, entry] of Object.entries(object(entries))) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) { skipped++; continue; }
        add({ ...object(entry), id: object(entry).id ?? id }, provider, `${provider}/${id}`);
      }
    }
  } else {
    const entries = object(raw).data;
    if (!Array.isArray(entries)) throw new Error('Invalid catalog shape');
    for (const entry of entries) { const id = object(entry).id; add(entry, string(id) ? id.split('/')[0]! : '', string(id) ? id : ''); }
  }
  const state: SourceSnapshot = { source: `catalog:${config.id}`, kind: 'catalog', at, hostname: url.hostname, models };
  return { state, skipped };
}
