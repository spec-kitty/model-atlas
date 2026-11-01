import { capabilities } from './types.ts';
import type { Claim, Claims, Field, Lifecycle, Pricing, SourceKind, StoredModel } from './types.ts';
import { date, number, object, string, strings } from './transport.ts';

export const priority: Record<SourceKind, number> = { default: 0, catalog: 1, endpoint: 2, probe: 3, override: 4 };
export function validField(field: string): field is Field {
  return ['displayName', 'reasoning.efforts', 'reasoning.thinkingModes', 'limits.contextTokens',
    'limits.maxInputTokens', 'limits.maxOutputTokens', 'pricing', 'lifecycle', 'releasedAt'].includes(field)
    || capabilities.some(c => field === `capabilities.${c}`);
}
export function cleanValue(field: Field, value: unknown, clean: (s: string) => string): unknown {
  if (field.startsWith('capabilities.')) return typeof value === 'boolean' ? value : undefined;
  if (field.startsWith('limits.')) return number(value) && Number.isSafeInteger(value) ? value : undefined;
  if (field.startsWith('reasoning.')) return strings(value) ? [...new Set(value.map(clean))] : undefined;
  if (field === 'displayName') return string(value) ? clean(value) : undefined;
  if (field === 'releasedAt') return date(value) ? value : undefined;
  if (field === 'pricing') {
    const p = object(value); const out: Pricing = { currency: 'USD' };
    if (p.currency !== 'USD') return undefined;
    for (const k of ['inputPerMTok', 'outputPerMTok', 'cacheReadPerMTok', 'cacheWritePerMTok'] as const) {
      if (number(p[k])) out[k] = p[k];
    }
    return Object.keys(out).length > 1 ? out : undefined;
  }
  if (field === 'lifecycle') {
    const l = object(value);
    if (typeof l.status !== 'string' || !['active', 'deprecated', 'retired'].includes(l.status)) return undefined;
    const out: Lifecycle = { status: l.status as Lifecycle['status'] };
    if (date(l.deprecatedAt)) out.deprecatedAt = l.deprecatedAt;
    if (date(l.retiresAt)) out.retiresAt = l.retiresAt;
    return out;
  }
  return undefined;
}
export function addClaim(claims: Claims, field: Field, value: unknown, source: SourceKind, via: string, at: string, clean = (s: string) => s) {
  const validated = cleanValue(field, value, clean);
  if (validated !== undefined) (claims[field] ??= []).push({ value: validated, source, via: clean(via), at });
}
export function winning(list: Claim<unknown>[] = []): Claim<unknown> | undefined {
  // Equal precedence: newest timestamp, then later insertion (stable source/config order).
  return list.reduce<Claim<unknown> | undefined>((best, c) => !best || priority[c.source] > priority[best.source]
    || (priority[c.source] === priority[best.source] && c.at >= best.at) ? c : best, undefined);
}
export function mergeClaims(target: Claims, incoming: Claims) {
  for (const [field, list] of Object.entries(incoming)) if (validField(field) && list) (target[field] ??= []).push(...list);
}
export interface NormalizeContext { source: SourceKind; via: string; at: string; provider: string; kind?: string; clean: (s: string) => string }
export function normalize(raw: unknown, ctx: NormalizeContext, catalog = false): StoredModel | undefined {
  const r = object(raw);
  const rawId = r.model_name ?? r.id ?? (r.kind !== undefined || r.supportsImageInput !== undefined ? r.name : undefined);
  if (!string(rawId)) return undefined;
  const model: StoredModel = { provider: ctx.provider, id: ctx.clean(rawId), claims: {} };
  const add = (f: Field, v: unknown, source = ctx.source) => addClaim(model.claims, f, v, source, ctx.via, ctx.at, ctx.clean);
  const caps = object(r.capabilities);
  const modality = (input: unknown, output: unknown) => {
    if (strings(input)) {
      for (const [name, cap] of [['text', 'textInput'], ['image', 'imageInput'], ['audio', 'audioInput'], ['video', 'videoInput']] as const) {
        add(`capabilities.${cap}`, input.includes(name));
      }
      // Neither generic "file" nor PDF's absence establishes PDF support or rejection.
      if (input.includes('pdf')) add('capabilities.pdfInput', true);
    }
    if (strings(output)) {
      add('capabilities.textOutput', output.includes('text')); add('capabilities.imageOutput', output.includes('image'));
    }
  };
  const price = (raw: unknown, keys: string[], factor: number) => {
    const p = object(raw); const out: Pricing = { currency: 'USD' };
    const fields = ['inputPerMTok', 'outputPerMTok', 'cacheReadPerMTok', 'cacheWritePerMTok'] as const;
    keys.forEach((k, i) => {
      const value = p[k];
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      const field = fields[i];
      if (field && number(n) && number(n * factor)) out[field] = Number((n * factor).toPrecision(15));
    });
    add('pricing', out);
  };
  const bools = (block: Record<string, unknown>, mapping: Record<string, string>) => {
    for (const [key, cap] of Object.entries(mapping)) add(`capabilities.${cap}` as Field, block[key]);
  };
  add('displayName', r.display_name ?? r.displayName ?? r.name);
  if (number(r.created)) { const d = new Date(r.created * 1000); if (Number.isFinite(d.getTime())) add('releasedAt', d.toISOString()); }
  add('releasedAt', r.created_at);
  add('limits.maxInputTokens', r.max_input_tokens);
  add('limits.maxOutputTokens', r.max_tokens);
  add('limits.maxOutputTokens', r.max_output_tokens);
  add('limits.contextTokens', r.context_length);
  const architecture = object(r.architecture);
  modality(architecture.input_modalities, architecture.output_modalities);
  if (strings(r.supported_parameters)) {
    const params = r.supported_parameters;
    const mapping = { tools: ['tools'], toolChoice: ['tool_choice'], parallelToolCalls: ['parallel_tool_calls'],
      structuredOutput: ['structured_outputs', 'response_format'], reasoning: ['reasoning', 'include_reasoning', 'reasoning_effort'],
      streaming: ['stream'], temperature: ['temperature'], topP: ['top_p'], topK: ['top_k'], seed: ['seed'] };
    for (const [cap, names] of Object.entries(mapping)) {
      const present = names.some(n => params.includes(n));
      if (present || ['temperature', 'topP', 'topK', 'seed'].includes(cap)) add(`capabilities.${cap}` as Field, present);
    }
  }
  add('limits.maxOutputTokens', object(r.top_provider).max_completion_tokens);
  price(r.pricing, ['prompt', 'completion', 'input_cache_read', 'input_cache_write'], 1e6);
  add('reasoning.efforts', object(r.reasoning).supported_efforts);
  if (date(r.expiration_date)) add('lifecycle', { status: Date.parse(r.expiration_date) <= Date.parse(ctx.at) ? 'retired' : 'deprecated', retiresAt: r.expiration_date });
  for (const [key, cap] of Object.entries({ image_input: 'imageInput', pdf_input: 'pdfInput', structured_outputs: 'structuredOutput', thinking: 'reasoning' })) {
    add(`capabilities.${cap}` as Field, object(caps[key]).supported);
  }
  const supportedKeys = (o: Record<string, unknown>) => Object.entries(o).filter(([k, v]) => k !== 'supported' && object(v).supported === true).map(([k]) => k);
  if (caps.thinking !== undefined && Object.keys(object(object(caps.thinking).types)).length) add('reasoning.thinkingModes', supportedKeys(object(object(caps.thinking).types)));
  if (caps.effort !== undefined && Object.keys(object(caps.effort)).length) add('reasoning.efforts', supportedKeys(object(caps.effort)));
  if (typeof r.lifecycle === 'string') add('lifecycle', { status: r.lifecycle, deprecatedAt: r.deprecated_at, retiresAt: r.retires_at });
  bools(caps, { tool_calling: 'tools', parallel_tool_calls: 'parallelToolCalls', reasoning: 'reasoning', vision: 'imageInput', structured_output: 'structuredOutput' });
  const info = object(r.model_info);
  bools(info, { supports_vision: 'imageInput', supports_function_calling: 'tools', supports_tool_choice: 'toolChoice',
    supports_reasoning: 'reasoning', supports_response_schema: 'structuredOutput', supports_pdf_input: 'pdfInput',
    supports_audio_input: 'audioInput', supports_native_streaming: 'streaming' });
  add('limits.maxInputTokens', info.max_input_tokens); add('limits.maxOutputTokens', info.max_output_tokens ?? info.max_tokens);
  price(info, ['input_cost_per_token', 'output_cost_per_token', 'cache_read_input_token_cost', 'cache_creation_input_token_cost'], 1e6);
  bools(r, { supportsImageInput: 'imageInput', supportsTools: 'tools' });
  add('limits.contextTokens', r.contextLength);
  if (r.kind === 'EMBEDDING_MODEL') add('capabilities.embeddings', true);
  const sampling = object(r.defaultSamplingParams);
  for (const [key, cap] of [['temperature', 'temperature'], ['top_p', 'topP'], ['top_k', 'topK'], ['seed', 'seed']] as const) {
    if (number(sampling[key])) add(`capabilities.${cap}`, true);
  }
  if (r.state === 'READY') add('lifecycle', { status: 'active' });
  if (date(r.deprecationDate)) add('lifecycle', { status: 'deprecated', deprecatedAt: r.deprecationDate });
  if (r.state === 'DEPRECATED' || r.state === 'RETIRED' || r.state === 'DELETED') add('lifecycle', { status: r.state === 'DEPRECATED' ? 'deprecated' : 'retired', deprecatedAt: r.deprecationDate });
  if (ctx.kind === 'anthropic') add('capabilities.tools', true, 'default');
  if (rawId.startsWith('text-embedding-')) add('capabilities.embeddings', true, 'default');
  if (catalog) {
    bools(r, { reasoning: 'reasoning', tool_call: 'tools', structured_output: 'structuredOutput', temperature: 'temperature' });
    modality(object(r.modalities).input, object(r.modalities).output);
    const limit = object(r.limit);
    add('limits.contextTokens', limit.context); add('limits.maxInputTokens', limit.input); add('limits.maxOutputTokens', limit.output);
    price(r.cost, ['input', 'output', 'cache_read', 'cache_write'], 1);
    add('releasedAt', r.release_date);
    if (Array.isArray(r.reasoning_options)) {
      const modes: string[] = [];
      for (const option of r.reasoning_options) {
        const o = object(option);
        if (o.type === 'effort') add('reasoning.efforts', o.values);
        else if (string(o.type)) modes.push(o.type);
      }
      if (modes.length) add('reasoning.thinkingModes', modes);
    }
  }
  if (string(r.canonical_model_id)) model.canonical = ctx.clean(r.canonical_model_id);
  return model;
}
