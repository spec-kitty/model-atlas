import type { CatalogConfig, ModelRecord, StoredModel } from './types.ts';
export function modelsDev(options: { providerMap?: Record<string, string | null> } = {}): CatalogConfig {
  return { id: 'models.dev', kind: 'models.dev', ...options };
}
export function openRouterCatalog(options: { providerMap?: Record<string, string | null> } = {}): CatalogConfig {
  return { id: 'openrouter-catalog', kind: 'openrouter', ...options };
}
export function matchCatalog(model: StoredModel, entries: StoredModel[], config: CatalogConfig): {
  matches: StoredModel[]; ambiguous: boolean; method: NonNullable<ModelRecord['catalogMatch']>['method'];
} {
  const mapped = config.providerMap?.[model.provider];
  if (mapped != null) {
    return { matches: entries.filter(e => e.provider === mapped && e.id === model.id), ambiguous: false, method: 'provider-mapped' };
  }
  const matches = entries.filter(e => e.id === model.id || e.canonical === model.id || (model.canonical !== undefined && (e.canonical === model.canonical || e.id === model.canonical)));
  const canonical = new Set(matches.map(e => e.canonical ?? e.catalogKey ?? `${e.provider}/${e.id}`));
  return { matches, ambiguous: canonical.size > 1, method: matches.some(e => e.id === model.id) ? 'exact' : 'canonical' };
}
