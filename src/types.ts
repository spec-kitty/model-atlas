export type SourceKind = 'override' | 'probe' | 'endpoint' | 'catalog' | 'default';
export interface Claim<T> { value: T; source: SourceKind; via: string; at: string }
export const capabilities = [
  'textInput', 'imageInput', 'pdfInput', 'audioInput', 'videoInput', 'textOutput',
  'imageOutput', 'embeddings', 'tools', 'toolChoice', 'parallelToolCalls',
  'structuredOutput', 'reasoning', 'streaming', 'temperature', 'topP', 'topK', 'seed',
] as const;
export type Capability = typeof capabilities[number];
export interface Pricing {
  currency: 'USD'; inputPerMTok?: number; outputPerMTok?: number;
  cacheReadPerMTok?: number; cacheWritePerMTok?: number;
}
export interface Lifecycle { status: 'active' | 'deprecated' | 'retired'; deprecatedAt?: string; retiresAt?: string }
export interface ModelRecord {
  provider: string; id: string; displayName?: Claim<string>;
  capabilities: Partial<Record<Capability, Claim<boolean>>>;
  reasoning?: { efforts?: Claim<string[]>; thinkingModes?: Claim<string[]> };
  limits: { contextTokens?: Claim<number>; maxInputTokens?: Claim<number>; maxOutputTokens?: Claim<number> };
  pricing?: Claim<Pricing>; lifecycle?: Claim<Lifecycle>;
  /** Provider creation/release date; never the refresh date. */
  releasedAt?: Claim<string>;
  catalogMatch?: { catalog: string; key: string; method: 'exact' | 'provider-mapped' | 'canonical' };
}
export type ProviderKind = 'anthropic' | 'openai' | 'openai-compatible' | 'openrouter' | 'fireworks';
export interface ProviderConfig {
  id: string; kind: ProviderKind; baseUrl?: string; apiKey?: string;
  headers?: Record<string, string>; account?: string;
}
export interface CatalogConfig {
  id: string; kind: 'models.dev' | 'openrouter';
  /** null means no provider-specific mapping; conservative global matching still applies. */
  providerMap?: Record<string, string | null>;
}
export interface FieldValues {
  displayName: string; 'reasoning.efforts': string[]; 'reasoning.thinkingModes': string[];
  'limits.contextTokens': number; 'limits.maxInputTokens': number; 'limits.maxOutputTokens': number;
  pricing: Pricing; lifecycle: Lifecycle; releasedAt: string;
}
export type Field = keyof FieldValues | `capabilities.${Capability}`;
export type FieldValue<F extends Field> = F extends keyof FieldValues ? FieldValues[F] : boolean;
export type Claims = Partial<Record<Field, Claim<unknown>[]>>;
export interface StoredModel {
  provider: string; id: string; claims: Claims;
  canonical?: string; catalogKey?: string;
}
export interface SourceSnapshot {
  source: string; kind: 'provider' | 'catalog'; at: string; hostname: string;
  models: StoredModel[];
  providerMap?: Record<string, string | null>;
}
export interface AtlasSnapshot {
  version: 1; createdAt: string; sources: SourceSnapshot[]; additions: StoredModel[];
}
export interface RefreshReport { source: string; ok: boolean; models: number; skipped: number; error?: string; warnings?: string[] }
export interface Explanation {
  model: ModelRecord; claims: Claims;
  catalogMatches: Array<{ catalog: string; status: 'matched' | 'ambiguous' | 'unmatched'; keys: string[] }>;
}
export type Preference = 'cheapest' | 'largestContext' | 'newest' | { provider: string; id?: string };
export interface SelectOptions {
  requires: Partial<Record<Capability, true>>; providers?: string[];
  exclude?: Array<string | { provider: string; id: string }>;
  minContextTokens?: number; prefer?: Preference[]; allowUnknown?: boolean;
}
export interface Candidate { model: ModelRecord; score: number; reasons: string[]; unknown: Capability[] }
export type ProbeCapability = 'imageInput' | 'tools' | 'structuredOutput' | 'temperature' | 'topP' | 'reasoning';
export type ProbeRequest = ProbeCapability | { capability: 'reasoning'; efforts: string[] };
export interface ProbeReport { capability: ProbeCapability | 'cache'; effort?: string; ok: boolean; value?: boolean; error?: string }
export interface AtlasOptions {
  providers?: ProviderConfig[]; catalogs?: CatalogConfig[]; fetch?: typeof globalThis.fetch;
  now?: () => Date; snapshot?: unknown; maxAgeMs?: number; timeoutMs?: number; maxResponseBytes?: number;
  /** Optional persistence sink. Load synchronously via snapshot before constructing the atlas. */
  cache?: { save(snapshot: AtlasSnapshot): void | Promise<void> };
}
