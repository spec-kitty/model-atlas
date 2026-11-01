import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAtlas, modelsDev, openRouterCatalog } from '../src/index.ts';
import type { ProviderKind } from '../src/index.ts';
import { fixture, mock, now } from './helpers.ts';

for (const [kind, file, id] of [
  ['anthropic', 'anthropic-models', 'claude-opus-5-5'], ['openrouter', 'openrouter-models', 'anthropic/claude-haiku-5.5'],
  ['openai-compatible', 'tokenfactory-models', 'kimi-k3'], ['fireworks', 'fireworks-models', 'accounts/fireworks/models/kimi-k3'],
  ['openai', 'openai-models', 'gpt-5.4-mini'],
] as const) {
  test(`${kind}: fixture shape and auth`, async () => {
    const calls: URL[] = [];
    const atlas = createAtlas({ now, providers: [{ id: 'p', kind, apiKey: 'SECRET', ...(kind === 'openai-compatible' ? { baseUrl: 'https://gateway.test/v1' } : {}) }],
      fetch: mock((url, init) => {
        calls.push(url);
        const h = new Headers(init.headers);
        if (kind === 'anthropic') { assert.equal(h.get('x-api-key'), 'SECRET'); assert.equal(h.get('anthropic-version'), '2023-06-01'); }
        else assert.equal(h.get('authorization'), 'Bearer SECRET');
        return url.pathname === '/model/info' ? fixture('litellm-model-info') : fixture(file);
      }) });
    assert.equal((await atlas.refresh())[0]?.ok, true);
    const m = atlas.model('p', id)!;
    assert.ok(m);
    if (kind === 'anthropic') {
      assert.equal(m.capabilities.imageInput?.value, true); assert.equal(m.capabilities.pdfInput?.value, true);
      assert.equal(m.capabilities.tools?.source, 'default'); assert.equal(m.capabilities.structuredOutput?.value, true);
      assert.deepEqual(m.reasoning?.efforts?.value, ['low', 'medium', 'high', 'xhigh', 'max']);
      assert.deepEqual(m.reasoning?.thinkingModes?.value, ['adaptive', 'between_tools', 'disabled']);
      assert.equal(m.limits.maxInputTokens?.value, 1_000_000); assert.equal(m.limits.maxOutputTokens?.value, 128_000);
      assert.equal(atlas.model('p', 'claude-haiku-4-5-20251001')?.lifecycle?.value.status, 'deprecated');
      assert.equal(calls[0]?.searchParams.get('limit'), '1000');
    } else if (kind === 'openrouter') {
      assert.equal(m.capabilities.temperature?.value, false); assert.equal(m.capabilities.topP?.value, false);
      assert.equal(m.capabilities.tools?.value, true); assert.equal(m.capabilities.pdfInput, undefined);
      assert.equal(m.pricing?.value.inputPerMTok, 0.1); assert.equal(m.pricing?.value.cacheReadPerMTok, 0.01);
      assert.equal(m.pricing?.value.cacheWritePerMTok, 0.125); assert.equal(m.limits.contextTokens?.value, 1_000_000);
      assert.equal(m.limits.maxOutputTokens?.value, 128_000);
      assert.equal(atlas.supports('p', 'z-ai/glm-5.3', 'imageInput'), false);
    } else if (kind === 'openai-compatible') {
      assert.equal(m.capabilities.imageInput?.value, true); assert.equal(m.capabilities.parallelToolCalls?.value, true);
      assert.equal(atlas.supports('p', 'glm-5.3', 'imageInput'), false);
      assert.equal(atlas.supports('p', 'deepseek-v4.1-flash-1017-uncensored-fp8', 'imageInput'), true);
      assert.equal(m.limits.maxInputTokens?.value, 983040); assert.equal(m.pricing?.value.inputPerMTok, 0);
      assert.equal(calls[1]?.pathname, '/model/info');
    } else if (kind === 'fireworks') {
      assert.equal(m.capabilities.imageInput?.value, true); assert.equal(m.capabilities.tools?.value, true);
      assert.equal(m.capabilities.temperature?.value, true); assert.equal(m.limits.contextTokens?.value, 262144);
      assert.equal(atlas.supports('p', 'accounts/fireworks/models/qwen3-embedding-8b', 'embeddings'), true);
      assert.equal(calls[0]?.searchParams.get('pageSize'), '200');
    } else {
      assert.deepEqual(m.capabilities, {});
      assert.equal(atlas.model('p', 'text-embedding-3-small')?.capabilities.embeddings?.source, 'default');
    }
  });
}
test('LiteLLM null flags produce no capability claims; gateway shapes detected per entry', async () => {
  const atlas = createAtlas({ providers: [{ id: 'p', kind: 'openai' }], fetch: mock(() => fixture('litellm-model-info')), now });
  await atlas.refresh();
  for (const m of atlas.models()) assert.deepEqual(m.capabilities, {});
  assert.equal(atlas.model('p', 'kimi-k3')?.limits.maxOutputTokens?.value, 65536);
});
test('flat and tree capabilities merge with OpenRouter fields, independent of kind', async () => {
  const atlas = createAtlas({ providers: [{ id: 'p', kind: 'openai' }], fetch: mock(() => fixture('tokenfactory-models')), now });
  await atlas.refresh();
  const claims = atlas.explain('p', 'kimi-k3')!.claims;
  assert.equal(claims['capabilities.imageInput']?.length, 2);
  assert.equal(atlas.supports('p', 'kimi-k3', 'streaming'), true);
});
test('models.dev mapping and reasoning/limits/cache cost; OpenRouter catalog', async () => {
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }], catalogs: [modelsDev({ providerMap: { p: 'openai' } }), openRouterCatalog()],
    fetch: mock(url => url.hostname === 'models.dev' ? fixture('modelsdev-api') : url.hostname === 'openrouter.ai' ? fixture('openrouter-models') : fixture('openai-models')) });
  const reports = await atlas.refresh(); assert.ok(reports.every(r => r.ok));
  const m = atlas.model('p', 'gpt-5.4-mini')!;
  assert.equal(m.capabilities.imageInput?.source, 'catalog'); assert.equal(m.pricing?.value.inputPerMTok, 0.75);
  assert.equal(m.pricing?.value.cacheReadPerMTok, 0.075); assert.equal(m.limits.maxInputTokens?.value, 272000);
  assert.deepEqual(m.reasoning?.efforts?.value, ['none', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(m.catalogMatch?.method, 'provider-mapped');
  const or = createAtlas({ now, providers: [{ id: 'x', kind: 'openai' }], catalogs: [openRouterCatalog()], fetch: mock(url => url.hostname === 'openrouter.ai' ? fixture('openrouter-models') : { data: [{ id: 'anthropic/claude-haiku-5.5' }] }) });
  await or.refresh(); assert.equal(or.model('x', 'anthropic/claude-haiku-5.5')?.capabilities.temperature?.value, false);
});
test('ambiguous catalogs refused; same canonical aliases permitted; null mapping is global lookup', async () => {
  const data = { a: { models: { shared: { id: 'shared', tool_call: true } } }, b: { models: { shared: { id: 'shared', tool_call: false } } } };
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }], catalogs: [modelsDev({ providerMap: { p: null } })], fetch: mock(url => url.hostname === 'models.dev' ? data : { data: [{ id: 'shared' }, { id: 'share' }] }) });
  await atlas.refresh();
  assert.equal(atlas.supports('p', 'shared', 'tools'), undefined);
  assert.equal(atlas.explain('p', 'shared')?.catalogMatches[0]?.status, 'ambiguous');
  assert.equal(atlas.explain('p', 'share')?.catalogMatches[0]?.status, 'unmatched');
  Object.assign(data.a.models.shared, { canonical_model_id: 'vendor/shared' });
  Object.assign(data.b.models.shared, { canonical_model_id: 'vendor/shared' });
  await atlas.refresh(); assert.equal(atlas.explain('p', 'shared')?.catalogMatches[0]?.status, 'matched');
});
test('canonical matching across providers; exact mapping does not cross provider on miss', async () => {
  const catalogs = [modelsDev()];
  const fetch = mock(url => url.hostname === 'models.dev' ? fixture('modelsdev-api') : { data: [{ id: 'moonshotai/kimi-k3' }, { id: 'kimi-k3' }] });
  const atlas = createAtlas({ providers: [{ id: 'p', kind: 'openai' }], catalogs, fetch, now });
  await atlas.refresh();
  assert.equal(atlas.model('p', 'moonshotai/kimi-k3')?.catalogMatch?.method, 'canonical');
  assert.equal(atlas.supports('p', 'kimi-k3', 'imageInput'), true);
  const mapped = createAtlas({ providers: [{ id: 'p', kind: 'openai' }], catalogs: [modelsDev({ providerMap: { p: 'openai' } })], fetch, now });
  await mapped.refresh(); assert.equal(mapped.supports('p', 'kimi-k3', 'imageInput'), undefined);
});
test('Anthropic and Fireworks pagination, duplicate merge and repeated-cursor failure', async () => {
  for (const kind of ['anthropic', 'fireworks'] satisfies ProviderKind[]) {
    let count = 0;
    const atlas = createAtlas({ now, providers: [{ id: 'p', kind }], fetch: mock(url => {
      count++;
      if (count === 2) assert.equal(url.searchParams.get(kind === 'anthropic' ? 'after_id' : 'pageToken'), 'cursor');
      return kind === 'anthropic' ? { data: [{ id: `m${count}` }], has_more: count === 1, last_id: 'cursor' }
        : { models: [{ name: `m${count}`, kind: 'HF_BASE_MODEL' }], nextPageToken: count === 1 ? 'cursor' : '' };
    }) });
    assert.equal((await atlas.refresh())[0]?.models, 2);
  }
  const bad = createAtlas({ providers: [{ id: 'p', kind: 'anthropic' }], fetch: mock(() => ({ data: [{ id: 'm' }], has_more: true, last_id: 'same' })) });
  assert.equal((await bad.refresh())[0]?.ok, false);
});
test('malformed entries skipped, unknown is not false, expiry and Fireworks lifecycle', async () => {
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }], fetch: mock(() => ({ data: [null, {}, { id: 2 }, { id: 'm', capabilities: { vision: null }, supported_parameters: null, context_length: -1, pricing: { prompt: 'nan' } }, { id: 'old', expiration_date: '2026-01-01' }, { name: 'fw', kind: 'HF_BASE_MODEL', state: 'DEPRECATED', deprecationDate: '2026-01-01' }] })) });
  assert.equal((await atlas.refresh())[0]?.skipped, 3);
  assert.equal(atlas.supports('p', 'm', 'imageInput'), undefined);
  assert.equal(atlas.model('p', 'm')?.pricing, undefined);
  assert.equal(atlas.model('p', 'old')?.lifecycle?.value.status, 'retired');
  assert.equal(atlas.model('p', 'fw')?.lifecycle?.value.status, 'deprecated');
});
test('malformed catalog entries and hostile optional fields are safely discarded', async () => {
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }], catalogs: [modelsDev()], fetch: mock(url => url.hostname === 'models.dev'
    ? { broken: null, a: { models: { bad: null, bad2: 3, good: { id: 'm', tool_call: true } } } }
    : { data: [{ id: 'm', capabilities: [], model_info: 'invalid', supported_parameters: [null], lifecycle: { toString: 1 }, created: Number.MAX_VALUE }] }) });
  const reports = await atlas.refresh(); assert.ok(reports.every(r => r.ok));
  assert.equal(reports[1]?.skipped, 3); assert.equal(atlas.supports('p', 'm', 'tools'), true);
  assert.equal(atlas.supports('p', 'm', 'temperature'), undefined);
  assert.equal(atlas.model('p', 'm')?.releasedAt, undefined);
});

test('future expiration is deprecated with a retirement date', async () => {
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openrouter' }], fetch: mock(() => ({ data: [{ id: 'm', expiration_date: '2027-01-01' }] })) });
  await atlas.refresh();
  assert.deepEqual(atlas.model('p', 'm')?.lifecycle?.value, { status: 'deprecated', retiresAt: '2027-01-01' });
  assert.equal(atlas.select({ requires: {} }).length, 1);
});

test('catalog edits do not establish release dates or affect newest preference', async () => {
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }], catalogs: [modelsDev()], fetch: mock(url => url.hostname === 'models.dev'
    ? { vendor: { models: { edited: { last_updated: '2026-11-01' }, released: { release_date: '2025-01-01', last_updated: '2026-11-01' } } } }
    : { data: [{ id: 'edited' }, { id: 'released' }] }) });
  await atlas.refresh();
  assert.equal(atlas.model('p', 'edited')?.releasedAt, undefined);
  assert.equal(atlas.model('p', 'released')?.releasedAt?.value, '2025-01-01');
  assert.deepEqual(atlas.select({ requires: {}, prefer: ['newest'] }).map(c => c.model.id), ['released', 'edited']);
});

test('endpoint provenance includes the requested base path without query secrets', async () => {
  for (const path of ['/v1', '/gateway/v2']) {
    const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai-compatible', baseUrl: `https://gateway.test${path}?key=SECRET` }],
      fetch: mock(url => url.pathname === '/model/info' ? { data: [] } : { data: [{ id: 'm', capabilities: { vision: true } }] }) });
    await atlas.refresh();
    assert.equal(atlas.model('p', 'm')?.capabilities.imageInput?.via, `p:${path}/models`);
    assert.equal(JSON.stringify(atlas.toSnapshot()).includes('SECRET'), false);
  }
});
