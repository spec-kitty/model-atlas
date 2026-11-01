import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAtlas, modelsDev, openRouterCatalog } from '../src/index.ts';
import type { AtlasSnapshot, Capability, Field, Preference, ProbeRequest } from '../src/index.ts';
import { mock, now, reply } from './helpers.ts';

test('optional enrichment failures warn without losing the primary listing or exposing errors', async () => {
  for (const failure of ['timeout', 'size', 'network', 'shape', 'http']) {
    const atlas = createAtlas({ now, timeoutMs: 10, maxResponseBytes: 128,
      providers: [{ id: 'p', kind: 'openai-compatible', baseUrl: 'https://gateway.test/v1', apiKey: 'SECRET' }],
      fetch: mock(url => {
        if (url.pathname !== '/model/info') return { data: [{ id: 'm' }] };
        if (failure === 'timeout') return new Promise(() => {});
        if (failure === 'size') return new Response('x'.repeat(129));
        if (failure === 'network') throw new Error('SECRET');
        if (failure === 'http') return new Response('SECRET', { status: 500 });
        return { data: 'SECRET' };
      }) });
    const [report] = await atlas.refresh();
    assert.equal(report?.ok, true); assert.equal(report.models, 1);
    assert.equal(report.warnings?.length, 1);
    const expected = { timeout: 'Request timed out', size: 'Response too large', network: 'Network request failed', shape: 'Invalid listing shape', http: 'HTTP 500' }[failure];
    assert.equal(report.warnings?.[0], `Optional /model/info enrichment failed: ${expected}`);
    assert.equal(JSON.stringify(report).includes('SECRET'), false);
    assert.ok(atlas.model('p', 'm'));
  }
});

test('PDF needs explicit evidence; absent non-sampling parameters remain unknown', async () => {
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openrouter' }], fetch: mock(() => ({ data: [
    { id: 'text', architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['temperature'] },
    { id: 'file', architecture: { input_modalities: ['text', 'file'] } },
    { id: 'pdf', architecture: { input_modalities: ['pdf'] } },
    { id: 'no-pdf', architecture: { input_modalities: ['text'] }, capabilities: { pdf_input: { supported: false } } },
  ] })) });
  await atlas.refresh();
  for (const id of ['text', 'file']) assert.equal(atlas.supports('p', id, 'pdfInput'), undefined);
  assert.equal(atlas.supports('p', 'pdf', 'pdfInput'), true);
  assert.equal(atlas.supports('p', 'no-pdf', 'pdfInput'), false);
  for (const cap of ['tools', 'toolChoice', 'parallelToolCalls', 'structuredOutput', 'reasoning', 'streaming'] as const) {
    assert.equal(atlas.supports('p', 'text', cap), undefined);
  }
  for (const cap of ['topP', 'topK', 'seed'] as const) assert.equal(atlas.supports('p', 'text', cap), false);
  assert.equal(atlas.supports('p', 'text', 'temperature'), true);
  assert.deepEqual(atlas.select({ requires: { pdfInput: true }, allowUnknown: true }).map(c => c.model.id), ['file', 'pdf', 'text']);
});

test('future snapshots warn and stay stale; invalid timestamps are discarded; age is checked at read time', () => {
  for (const stamp of ['9999-01-01', 'garbage', '2026-13-45', '2020-01-01', now().toISOString()]) {
    let time = now();
    const atlas = createAtlas({ now: () => time, maxAgeMs: 10, snapshot: { version: 1, sources: [
      { source: 'provider:p', kind: 'provider', at: stamp, hostname: 'host.test', models: [] },
    ] } });
    assert.equal(atlas.isStale('p'), stamp !== now().toISOString());
    assert.equal(atlas.snapshotWarnings.length, ['9999-01-01', 'garbage', '2026-13-45'].includes(stamp) ? 1 : 0);
    time = new Date(time.getTime() + 11);
    assert.equal(atlas.isStale('provider:p'), true);
  }
  const empty = createAtlas({ now, snapshot: { version: 1 } });
  assert.deepEqual(empty.models(), []); assert.deepEqual(empty.snapshotWarnings, []);
  assert.deepEqual(empty.toSnapshot().additions, []); assert.equal(empty.isStale('p'), true);
});

test('catalog rebuilds preserve source claims, select exact aliases and round-trip matching metadata', async () => {
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }], catalogs: [modelsDev({ providerMap: { p: null } })],
    fetch: mock((url, init) => init.method === 'POST' ? reply('7381') : url.hostname === 'models.dev' ? {
      a: { models: { alias: { canonical_model_id: 'canonical', tool_call: false } } },
      z: { models: { exact: { canonical_model_id: 'canonical', tool_call: true } } },
    } : { data: [{ id: 'exact', canonical_model_id: 'canonical' }, { id: 'canonical' }] }) });
  await atlas.refresh();
  const before = atlas.toSnapshot().sources;
  for (let i = 0; i < 3; i++) {
    await atlas.probe('p', 'exact', ['imageInput']);
    atlas.setOverride('p', 'exact', 'displayName', 'Name');
  }
  assert.deepEqual(atlas.toSnapshot().sources, before);
  assert.equal(atlas.explain('p', 'exact')?.claims['capabilities.tools']?.length, 1);
  assert.equal(atlas.supports('p', 'exact', 'tools'), true);
  assert.deepEqual(atlas.model('p', 'exact')?.catalogMatch, { catalog: 'models.dev', key: 'z/exact', method: 'exact' });
  assert.equal(atlas.model('p', 'canonical')?.catalogMatch?.method, 'canonical');
  const snapshot = JSON.parse(JSON.stringify(atlas.toSnapshot()));
  const restored = createAtlas({ now, snapshot });
  assert.deepEqual(restored.explain('p', 'exact'), atlas.explain('p', 'exact'));
  assert.deepEqual(restored.toSnapshot(), snapshot);
  assert.equal(restored.toSnapshot().sources[1]?.providerMap?.p, null);
  assert.equal(restored.toSnapshot().sources[0]?.models[0]?.canonical, 'canonical');
  assert.equal(restored.toSnapshot().sources[1]?.models[0]?.catalogKey, 'a/alias');
});

test('selection handles partial prices, zero limits, cross-provider excludes and unknown runtime options', () => {
  const atlas = createAtlas({ now });
  atlas.setOverride('p', 'partial', 'pricing', { currency: 'USD', inputPerMTok: 0 });
  atlas.setOverride('p', 'full', 'pricing', { currency: 'USD', inputPerMTok: 1, outputPerMTok: 1 });
  atlas.setOverride('q', 'full', 'pricing', { currency: 'USD', inputPerMTok: 0, outputPerMTok: 0 });
  atlas.setOverride('p', 'full', 'limits.contextTokens', 0);
  assert.deepEqual(atlas.select({ requires: {}, prefer: ['cheapest'] }).map(c => [c.model.provider, c.model.id]), [['q', 'full'], ['p', 'full'], ['p', 'partial']]);
  assert.deepEqual(atlas.select({ requires: {}, minContextTokens: 0 }).map(c => c.model.id), ['full']);
  assert.deepEqual(atlas.select({ requires: {}, exclude: ['full'] }).map(c => c.model.id), ['partial']);
  assert.deepEqual(atlas.select({ requires: {}, prefer: ['bogus' as Preference] }).map(c => [c.model.provider, c.model.id]), [['p', 'full'], ['p', 'partial'], ['q', 'full']]);
  const requires = { ['bogus' as Capability]: true as const };
  assert.equal(atlas.select({ requires }).length, 0);
  assert.ok(atlas.select({ requires, allowUnknown: true }).every(c => c.unknown[0] === ('bogus' as Capability)));
  assert.deepEqual(atlas.models().map(m => [m.provider, m.id]), [['p', 'full'], ['p', 'partial'], ['q', 'full']]);
  assert.equal(atlas.explain('p', 'partial')?.claims.pricing?.[0]?.source, 'override');
  assert.throws(() => atlas.setOverride('p', 'x', 'invalid' as Field, true), /Unknown override field/);
  assert.throws(() => atlas.setOverride('p', 'x', 'limits.contextTokens', -1), /Invalid override value/);
  assert.equal(atlas.model('p', 'x'), undefined);
});

test('empty refresh filters make no requests and custom OpenAI bases are respected', async () => {
  const seen: string[] = [];
  let data: unknown[] = [{ id: 'm' }];
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai', baseUrl: 'https://proxy.test/custom' }],
    fetch: mock(url => { seen.push(url.href); return { data }; }) });
  assert.deepEqual(await atlas.refresh({ providers: [], catalogs: [] }), []); assert.deepEqual(seen, []);
  await atlas.refresh(); assert.deepEqual(seen, ['https://proxy.test/custom/models']);
  data = [null, {}, { id: 4 }];
  assert.deepEqual(await atlas.refresh(), [{ source: 'provider:p', ok: true, models: 0, skipped: 3 }]);
  assert.deepEqual(atlas.models(), []);
});

test('malformed pagination and catalog envelopes preserve earlier successful listings', async () => {
  for (const kind of ['anthropic', 'fireworks'] as const) {
    let bad = false;
    const atlas = createAtlas({ now, providers: [{ id: 'p', kind }], fetch: mock(() => ({ data: [{ id: 'm' }],
      ...(bad ? kind === 'anthropic' ? { has_more: true } : { nextPageToken: 0 } : {}) })) });
    await atlas.refresh(); const before = atlas.toSnapshot(); bad = true;
    assert.equal((await atlas.refresh())[0]?.ok, false); assert.deepEqual(atlas.toSnapshot(), before);
  }
  const invalid = createAtlas({ now, catalogs: [modelsDev(), openRouterCatalog()], fetch: mock(url => url.hostname === 'models.dev'
    ? { vendor: { models: [] } } : { data: {} }) });
  const reports = await invalid.refresh();
  assert.equal(reports[0]?.skipped, 1); assert.equal(reports[0]?.ok, true); assert.equal(reports[1]?.ok, false);
});

test('unconfigured probes do not fetch; invalid effort in a batch preserves earlier reports and persistence', async () => {
  let calls = 0; let saved: AtlasSnapshot | undefined;
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }], cache: { save(s) { saved = s; } },
    fetch: mock(() => { calls++; return reply('7381'); }) });
  assert.deepEqual(await atlas.probe('missing', 'm', ['imageInput']), [{ capability: 'imageInput', ok: false, error: 'Provider is not configured' }]);
  assert.equal(calls, 0);
  assert.deepEqual(await atlas.probe('p', 'm', ['imageInput', { capability: 'reasoning', efforts: ['bad token'] }]), [
    { capability: 'imageInput', ok: true, value: true }, { capability: 'reasoning', ok: false, error: 'Invalid effort levels' },
  ]);
  assert.equal(calls, 1); assert.deepEqual(saved, atlas.toSnapshot());
  assert.equal(atlas.explain('p', 'm')?.claims['capabilities.imageInput']?.[0]?.source, 'probe');
});

test('cache failure reports identify persistence after multi-capability and empty probe batches', async () => {
  for (const requests of [['imageInput', 'temperature'], []] satisfies ProbeRequest[][]) {
    const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }], fetch: mock(() => reply('7381')),
      cache: { save() { throw new Error('SECRET'); } } });
    const reports = await atlas.probe('p', 'm', requests);
    assert.deepEqual(reports.at(-1), { capability: 'cache', ok: false, error: 'Cache save failed' });
    assert.equal(reports.length, requests.length + 1);
    for (const cap of requests) assert.equal(atlas.supports('p', 'm', cap), true);
  }
});

test('probe reply boundaries and duplicate efforts retain documented semantics', async () => {
  for (const [capability, response, expected] of [
    ['structuredOutput', reply('{"wrong":"schema"}'), true],
    ['tools', { choices: [{ message: { tool_calls: [{ function: { name: 'other' } }] } }] }, undefined],
    ['imageInput', reply('The number is 7381.'), true],
    ['imageInput', reply('I cannot see images'), false],
    ['imageInput', reply(''), false],
    ['temperature', Response.json({ error: { param: 'temperature' } }, { status: 500 }), undefined],
  ] as const) {
    const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }], fetch: mock(() => response) });
    assert.equal((await atlas.probe('p', 'm', [capability]))[0]?.value, expected);
  }
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }], fetch: mock(() => reply()) });
  const reports = await atlas.probe('p', 'm', [{ capability: 'reasoning', efforts: ['low', 'low'] }]);
  assert.equal(reports.length, 2); // Each explicit request runs; supported effort values are a set.
  assert.deepEqual(atlas.model('p', 'm')?.reasoning?.efforts?.value, ['low']);
});

test('non-array published efforts cannot poison restored claims or default probes', async () => {
  for (const value of ['high', {}, 1, null]) {
    const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }],
      fetch: mock((_, init) => init.method === 'POST' ? reply() : { data: [{ id: 'm', reasoning: { supported_efforts: value } }] }) });
    await atlas.refresh();
    assert.equal(atlas.model('p', 'm')?.reasoning, undefined);
    const snapshot = atlas.toSnapshot();
    snapshot.sources[0]!.models[0]!.claims['reasoning.efforts'] = [{ value, source: 'endpoint', via: 'listing', at: now().toISOString() }];
    const restored = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }], snapshot, fetch: mock(() => reply()) });
    assert.equal(restored.model('p', 'm')?.reasoning, undefined);
    assert.deepEqual((await restored.probe('p', 'm', ['reasoning'])).map(r => r.effort), ['low', 'medium', 'high']);
  }
});
