import type { AtlasOptions, AtlasSnapshot, Capability, CatalogConfig, Claim, Explanation, Field, FieldValue, ModelRecord,
  ProbeReport, ProbeRequest, RefreshReport, SelectOptions, SourceSnapshot, StoredModel } from './types.ts';
import { capabilities } from './types.ts';
import { addClaim, cleanValue, mergeClaims, validField, winning } from './normalize.ts';
import { makeSanitizer, makeTransport, RequestError } from './transport.ts';
import { loadCatalog, loadProvider } from './sources.ts';
import { matchCatalog } from './catalogs.ts';
import { restoreSnapshot, snapshot } from './snapshot.ts';
import { select } from './selection.ts';
import { runProbe } from './probes.ts';

const key = (provider: string, id: string) => JSON.stringify([provider, id]);
export function createAtlas(options: AtlasOptions = {}) {
  const providers = structuredClone(options.providers ?? []);
  const catalogs = structuredClone(options.catalogs ?? []);
  for (const list of [providers, catalogs]) {
    const seen = new Set<string>();
    for (const config of list) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(config.id) || seen.has(config.id)) throw new Error('Source IDs must be unique safe identifiers');
      seen.add(config.id);
    }
  }
  const now = options.now ?? (() => new Date());
  const at = () => now().toISOString();
  const clean = makeSanitizer(providers);
  const timeout = options.timeoutMs ?? 20_000, maxBytes = options.maxResponseBytes ?? 20 * 1024 * 1024;
  const maxAge = options.maxAgeMs ?? 24 * 60 * 60 * 1000;
  if (![timeout, maxBytes, maxAge].every(n => Number.isFinite(n) && n >= 0) || timeout === 0 || maxBytes === 0) throw new Error('Invalid resource limit');
  const request = makeTransport(options.fetch ?? globalThis.fetch, timeout, maxBytes);
  const restored = restoreSnapshot(options.snapshot, clean);
  const sources = new Map(restored.sources.map(s => [s.source, s]));
  const additions = new Map(restored.additions.map(m => [key(m.provider, m.id), m]));
  let views = new Map<string, Explanation>();
  let queue = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work); queue = result.then(() => {}, () => {}); return result;
  };
  const toSnapshot = (): AtlasSnapshot => snapshot([...sources.values()], [...additions.values()], at());
  const persist = async (): Promise<RefreshReport[]> => {
    if (!options.cache) return [];
    try { await options.cache.save(toSnapshot()); return []; }
    catch { return [{ source: 'cache', ok: false, models: 0, skipped: 0, error: 'Cache save failed' }]; }
  };
  const rebuild = () => {
    const rows = new Map<string, StoredModel>();
    for (const source of sources.values()) if (source.kind === 'provider') for (const m of source.models) {
      const k = key(m.provider, m.id); const row = rows.get(k);
      if (row) mergeClaims(row.claims, structuredClone(m.claims)); else rows.set(k, structuredClone(m));
    }
    for (const m of additions.values()) if (!rows.has(key(m.provider, m.id))) rows.set(key(m.provider, m.id), { provider: m.provider, id: m.id, claims: {} });
    const next = new Map<string, Explanation>();
    for (const [k, row] of rows) {
      const model: ModelRecord = { provider: row.provider, id: row.id, capabilities: {}, limits: {} };
      const catalogMatches: Explanation['catalogMatches'] = [];
      for (const source of sources.values()) if (source.kind === 'catalog') {
        const id = source.source.slice('catalog:'.length);
        const config: CatalogConfig = catalogs.find(c => c.id === id) ?? { id, kind: 'models.dev', ...(source.providerMap ? { providerMap: source.providerMap } : {}) };
        const result = matchCatalog(row, source.models, config);
        catalogMatches.push({ catalog: id, status: result.ambiguous ? 'ambiguous' : result.matches.length ? 'matched' : 'unmatched', keys: result.matches.map(m => m.catalogKey ?? m.id) });
        if (!result.ambiguous && result.matches.length) {
          // Same-canonical aliases can have different serving prices: prefer exact ID, then lexical key.
          const match = [...result.matches].sort((a, b) => Number(b.id === row.id) - Number(a.id === row.id) || ((a.catalogKey ?? a.id) < (b.catalogKey ?? b.id) ? -1 : (a.catalogKey ?? a.id) > (b.catalogKey ?? b.id) ? 1 : 0))[0]!;
          mergeClaims(row.claims, structuredClone(match.claims));
          model.catalogMatch = { catalog: id, key: match.catalogKey ?? match.id, method: result.method };
        }
      }
      const extra = additions.get(k); if (extra) mergeClaims(row.claims, structuredClone(extra.claims));
      for (const capability of capabilities) {
        const claim = winning(row.claims[`capabilities.${capability}`]);
        if (claim) model.capabilities[capability] = claim as Claim<boolean>;
      }
      for (const limit of ['contextTokens', 'maxInputTokens', 'maxOutputTokens'] as const) {
        const claim = winning(row.claims[`limits.${limit}`]); if (claim) model.limits[limit] = claim as Claim<number>;
      }
      for (const field of ['efforts', 'thinkingModes'] as const) {
        const claim = winning(row.claims[`reasoning.${field}`]); if (claim) (model.reasoning ??= {})[field] = claim as Claim<string[]>;
      }
      const displayName = winning(row.claims.displayName); if (displayName) model.displayName = displayName as NonNullable<ModelRecord['displayName']>;
      const pricing = winning(row.claims.pricing); if (pricing) model.pricing = pricing as NonNullable<ModelRecord['pricing']>;
      const lifecycle = winning(row.claims.lifecycle); if (lifecycle) model.lifecycle = lifecycle as NonNullable<ModelRecord['lifecycle']>;
      const releasedAt = winning(row.claims.releasedAt); if (releasedAt) model.releasedAt = releasedAt as Claim<string>;
      next.set(k, { model, claims: row.claims, catalogMatches });
    }
    views = next;
  };
  rebuild();
  const models = (provider?: string) => structuredClone([...views.values()].map(v => v.model).filter(m => provider === undefined || m.provider === provider)
    .sort((a, b) => key(a.provider, a.id) < key(b.provider, b.id) ? -1 : 1));
  const add = (provider: string, id: string, field: Field, value: unknown, source: 'override' | 'probe', via: string) => {
    provider = clean(provider); id = clean(id);
    const k = key(provider, id); const row = additions.get(k) ?? { provider, id, claims: {} };
    addClaim(row.claims, field, value, source, via, at(), clean); additions.set(k, row);
  };
  return {
    snapshotWarnings: [...restored.warnings],
    models,
    model(provider: string, id: string): ModelRecord | undefined { return structuredClone(views.get(key(provider, id))?.model); },
    supports(provider: string, id: string, capability: Capability): boolean | undefined { return views.get(key(provider, id))?.model.capabilities[capability]?.value; },
    explain(provider: string, id: string): Explanation | undefined { return structuredClone(views.get(key(provider, id))); },
    select(options: SelectOptions) { return select(models(), options, at()); },
    toSnapshot,
    isStale(source: string): boolean {
      const s = sources.get(source) ?? sources.get(`provider:${source}`) ?? sources.get(`catalog:${source}`);
      return !s || now().getTime() - Date.parse(s.at) > maxAge;
    },
    setOverride<F extends Field>(provider: string, id: string, field: F, value: FieldValue<F> | null): void {
      if (!validField(field)) throw new Error('Unknown override field');
      if (value === null || value === undefined) return;
      if (cleanValue(field, value, clean) === undefined) throw new Error('Invalid override value');
      add(provider, id, field, value, 'override', 'override'); rebuild();
    },
    refresh(filter: { providers?: string[]; catalogs?: string[] } = {}): Promise<RefreshReport[]> {
      return enqueue(async () => {
        const stamp = at();
        const jobs = [
          ...providers.filter(p => !filter.providers || filter.providers.includes(p.id)).map(p => ({ source: `provider:${p.id}`, run: () => loadProvider(p, request, stamp, clean) })),
          ...catalogs.filter(c => !filter.catalogs || filter.catalogs.includes(c.id)).map(c => ({ source: `catalog:${c.id}`, run: async () => {
            const result = await loadCatalog(c, request, stamp, clean);
            if (c.providerMap) result.state.providerMap = Object.fromEntries(Object.entries(c.providerMap).map(([k, v]) => [clean(k), v === null ? null : clean(v)]));
            return result;
          } })),
        ];
        const results = await Promise.allSettled(jobs.map(j => j.run()));
        const reports: RefreshReport[] = [];
        results.forEach((result, i) => {
          const job = jobs[i]!;
          if (result.status === 'fulfilled') {
            const { state, skipped } = result.value; sources.set(job.source, state);
            reports.push({ source: job.source, ok: true, models: state.models.length, skipped });
          } else {
            // Only transport messages are trusted. Arbitrary thrown errors can contain credentials.
            const error = result.reason instanceof RequestError ? result.reason.message : 'Invalid source configuration, listing or pagination';
            reports.push({ source: job.source, ok: false, models: sources.get(job.source)?.models.length ?? 0, skipped: 0, error });
          }
        });
        rebuild(); reports.push(...await persist()); return reports;
      });
    },
    probe(provider: string, id: string, requests: ProbeRequest[]): Promise<ProbeReport[]> {
      return enqueue(async () => {
        const config = providers.find(p => p.id === provider);
        const reports: ProbeReport[] = [];
        if (!config) return requests.map(r => ({ capability: typeof r === 'string' ? r : r.capability, ok: false, error: 'Provider is not configured' }));
        for (const input of requests) {
          const capability = typeof input === 'string' ? input : input.capability;
          if (!['imageInput', 'tools', 'structuredOutput', 'temperature', 'topP', 'reasoning'].includes(capability)) {
            reports.push({ capability, ok: false, error: 'Unsupported probe' }); continue;
          }
          const row = views.get(key(provider, id))?.model;
          const published = row?.reasoning?.efforts;
          const efforts = capability === 'reasoning' ? (typeof input === 'object' ? input.efforts : published?.value.length ? published.value : ['low', 'medium', 'high']) : [undefined];
          // Whitelist syntactic effort tokens to prevent unbounded or accidental prompt-sized requests.
          if (capability === 'reasoning' && (!Array.isArray(efforts) || efforts.length === 0 || efforts.length > 32
            || [...efforts].some(e => typeof e !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(e)))) {
            reports.push({ capability, ok: false, error: 'Invalid effort levels' }); continue;
          }
          const supported = new Set(row?.reasoning?.efforts?.value ?? []);
          let knownEfforts = published !== undefined;
          let observedEffort = false;
          for (const effort of efforts) {
            const report = await runProbe(config, id, capability, effort, row?.capabilities.toolChoice?.value !== false, request);
            reports.push(report);
            if (report.value === undefined) continue;
            if (capability === 'reasoning' && effort !== undefined) {
              observedEffort = true;
              if (report.value) { knownEfforts = true; supported.add(effort); add(provider, id, 'capabilities.reasoning', true, 'probe', `probe:reasoning:${effort}`); }
              else supported.delete(effort);
              // A rejection of one effort does not establish absence of reasoning as a whole.
              if (knownEfforts) {
                add(provider, id, 'reasoning.efforts', [...supported], 'probe', `probe:reasoning:${effort}`);
              }
            } else add(provider, id, `capabilities.${capability}`, report.value, 'probe', `probe:${capability}`);
          }
          if (observedEffort) rebuild();
        }
        rebuild();
        const cacheErrors = await persist();
        if (cacheErrors.length) reports.push({ capability: requests.length ? (typeof requests[0] === 'string' ? requests[0] : requests[0]!.capability) : 'reasoning', ok: false, error: 'Cache save failed' });
        return reports;
      });
    },
  };
}
export type Atlas = ReturnType<typeof createAtlas>;
