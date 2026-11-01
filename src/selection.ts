import type { Candidate, Capability, ModelRecord, Preference, SelectOptions } from './types.ts';
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function cost(model: ModelRecord) {
  const p = model.pricing?.value;
  return p?.inputPerMTok !== undefined && p.outputPerMTok !== undefined ? p.inputPerMTok + p.outputPerMTok : Infinity;
}
function value(model: ModelRecord, preference: Preference): number {
  if (preference === 'cheapest') return cost(model);
  if (preference === 'largestContext') return -(model.limits.contextTokens?.value ?? -Infinity);
  if (preference === 'newest') return model.releasedAt ? -Date.parse(model.releasedAt.value) : Infinity;
  return model.provider === preference.provider && (preference.id === undefined || model.id === preference.id) ? 0 : 1;
}
export function select(models: ModelRecord[], options: SelectOptions, at: string): Candidate[] {
  const candidates: Candidate[] = [];
  const deprecated = (m: ModelRecord) => m.lifecycle?.value.status === 'deprecated' ? 1 : 0;
  for (const model of models) {
    const lifecycle = model.lifecycle?.value;
    if (lifecycle?.status === 'retired' || (lifecycle?.retiresAt && Date.parse(lifecycle.retiresAt) <= Date.parse(at))) continue;
    if (options.providers && !options.providers.includes(model.provider)) continue;
    if (options.exclude?.some(e => typeof e === 'string' ? e === model.id : e.provider === model.provider && e.id === model.id)) continue;
    const unknown: Capability[] = []; const reasons: string[] = []; let excluded = false;
    for (const [cap, required] of Object.entries(options.requires) as Array<[Capability, true | undefined]>) {
      if (!required) continue;
      const claim = model.capabilities[cap];
      if (claim?.value === false) { excluded = true; break; }
      if (claim === undefined) unknown.push(cap);
      else reasons.push(`${cap}: true (${claim.source})`);
    }
    if (excluded || (unknown.length > 0 && !options.allowUnknown)) continue;
    if (options.minContextTokens !== undefined && (model.limits.contextTokens?.value ?? -Infinity) < options.minContextTokens) continue;
    if (unknown.length) reasons.push(`Unknown: ${unknown.join(', ')}`);
    if (deprecated(model)) reasons.push('Deprecated: ranked last');
    for (const p of options.prefer ?? []) reasons.push(typeof p === 'string' ? `${p}: ${value(model, p)}` : `Preferred model/provider match: ${value(model, p) === 0}`);
    candidates.push({ model, score: 0, reasons, unknown });
  }
  candidates.sort((a, b) => {
    const lifecycle = deprecated(a.model) - deprecated(b.model);
    if (lifecycle) return lifecycle;
    for (const preference of options.prefer ?? []) {
      const av = value(a.model, preference), bv = value(b.model, preference);
      if (av !== bv) return av < bv ? -1 : 1;
    }
    return cmp(a.model.provider, b.model.provider) || cmp(a.model.id, b.model.id);
  });
  candidates.forEach((c, i) => { c.score = candidates.length - i; });
  return candidates;
}
