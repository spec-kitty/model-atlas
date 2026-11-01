import type { AtlasSnapshot, Claims, SourceKind, SourceSnapshot, StoredModel } from './types.ts';
import { addClaim, priority, validField } from './normalize.ts';
import { date, object, string } from './transport.ts';

/** Reconstruct only known fields. Unknown properties (including credentials) never survive. */
export function restoreSnapshot(raw: unknown, clean: (s: string) => string): { sources: SourceSnapshot[]; additions: StoredModel[]; warnings: string[] } {
  const warnings: string[] = []; const s = object(raw);
  const sources: SourceSnapshot[] = []; const additions: StoredModel[] = [];
  if (raw === undefined) return { sources, additions, warnings };
  if (s.version !== 1) return { sources, additions, warnings: ['Unsupported snapshot version'] };
  const readModel = (raw: unknown, allowed: SourceKind[]): StoredModel | undefined => {
    const m = object(raw);
    if (!string(m.provider) || !string(m.id)) { warnings.push('Skipped malformed snapshot model'); return; }
    const claims: Claims = {};
    for (const [field, values] of Object.entries(object(m.claims))) {
      if (!validField(field) || !Array.isArray(values)) continue;
      for (const rawClaim of values) {
        const c = object(rawClaim);
        if (typeof c.source !== 'string' || !Object.hasOwn(priority, c.source) || !allowed.includes(c.source as SourceKind) || !string(c.via) || !date(c.at)) continue;
        addClaim(claims, field, c.value, c.source as SourceKind, c.via, c.at, clean);
      }
    }
    return { provider: clean(m.provider), id: clean(m.id), claims,
      ...(string(m.canonical) ? { canonical: clean(m.canonical) } : {}),
      ...(string(m.catalogKey) ? { catalogKey: clean(m.catalogKey) } : {}) };
  };
  if (Array.isArray(s.sources)) for (const rawSource of s.sources) {
    const source = object(rawSource);
    if (!string(source.source) || !date(source.at) || !Array.isArray(source.models) || (source.kind !== 'provider' && source.kind !== 'catalog')) {
      warnings.push('Skipped malformed snapshot source'); continue;
    }
    const kind = source.kind as SourceSnapshot['kind'];
    if (!source.source.startsWith(`${kind}:`)) { warnings.push('Skipped malformed snapshot source'); continue; }
    let hostname = '';
    if (string(source.hostname)) {
      try { hostname = new URL(`https://${source.hostname}`).hostname; } catch { /* Discard invalid hosts. */ }
    }
    const models = source.models.map(m => readModel(m, kind === 'catalog' ? ['catalog', 'default'] : ['endpoint', 'default'])).filter(m => m !== undefined);
    const state: SourceSnapshot = { source: clean(source.source), kind, at: source.at, hostname: clean(hostname), models };
    const mapping: Record<string, string | null> = Object.create(null) as Record<string, string | null>;
    for (const [key, value] of Object.entries(object(source.providerMap))) if (value === null || string(value)) mapping[clean(key)] = value === null ? null : clean(value);
    if (Object.keys(mapping).length) state.providerMap = mapping;
    sources.push(state);
  }
  if (Array.isArray(s.additions)) for (const item of s.additions) { const m = readModel(item, ['probe', 'override']); if (m) additions.push(m); }
  return { sources, additions, warnings };
}
export function snapshot(sources: SourceSnapshot[], additions: StoredModel[], at: string): AtlasSnapshot {
  return structuredClone({ version: 1, createdAt: at, sources, additions });
}
