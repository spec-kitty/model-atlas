import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAtlas, modelsDev } from '../src/index.ts';
import { fixture, mock, now, reply } from './helpers.ts';

test('precedence, losing claims, null overrides and synchronous detached reads', async () => {
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'anthropic' }], catalogs: [modelsDev()], fetch: mock((url, init) => {
    if (init.method === 'POST') return { type: 'message', content: [{ type: 'text', text: 'wrong' }] };
    if (url.hostname === 'models.dev') return fixture('modelsdev-api');
    return fixture('anthropic-models');
  }) });
  await atlas.refresh();
  const id = 'claude-haiku-4-5-20251001';
  assert.equal(atlas.model('p', id)?.capabilities.tools?.source, 'catalog');
  assert.equal(atlas.model('p', id)?.capabilities.imageInput?.source, 'endpoint');
  await atlas.probe('p', id, ['imageInput']);
  assert.equal(atlas.model('p', id)?.capabilities.imageInput?.source, 'probe');
  assert.equal(atlas.supports('p', id, 'imageInput'), false);
  atlas.setOverride('p', id, 'capabilities.imageInput', true);
  atlas.setOverride('p', id, 'capabilities.imageInput', null);
  assert.equal(atlas.supports('p', id, 'imageInput'), true);
  assert.deepEqual(atlas.explain('p', id)?.claims['capabilities.imageInput']?.map(c => c.source), ['endpoint', 'catalog', 'probe', 'override']);
  const m = atlas.model('p', id)!; m.capabilities.imageInput!.value = false;
  assert.equal(atlas.supports('p', id, 'imageInput'), true);
  await atlas.refresh(); assert.equal(atlas.supports('p', id, 'imageInput'), true);
});
test('snapshots offline, overrides, staleness, mapping persistence and secret echoes', async () => {
  let time = new Date(now()); const secret = 'KEY_SECRET_123';
  const atlas = createAtlas({ now: () => time, maxAgeMs: 100, providers: [{ id: 'p', kind: 'openai-compatible', baseUrl: 'https://user:password@gateway.test/v1?token=QUERY_SECRET', apiKey: secret, headers: { 'x-extra-auth': 'HEADER_SECRET' } }], catalogs: [modelsDev({ providerMap: { p: 'openai' } })], fetch: mock(url => {
    if (url.hostname === 'models.dev') return fixture('modelsdev-api');
    if (url.pathname === '/model/info') throw new Error(secret);
    return { data: [{ id: 'gpt-5.4-mini', name: secret }, { id: 'echo', name: 'https://user:password@gateway.test/?token=QUERY_SECRET', metadata: { authorization: 'HEADER_SECRET' } }] };
  }) });
  await atlas.refresh(); atlas.setOverride('p', 'gpt-5.4-mini', 'capabilities.temperature', false);
  assert.equal(atlas.isStale('p'), false); time = new Date(time.getTime() + 101); assert.equal(atlas.isStale('provider:p'), true);
  const snapshot = atlas.toSnapshot(); const json = JSON.stringify(snapshot);
  for (const forbidden of [secret, 'QUERY_SECRET', 'HEADER_SECRET', 'password', 'authorization', 'baseUrl']) assert.equal(json.includes(forbidden), false);
  assert.equal(snapshot.sources[0]?.hostname, 'gateway.test');
  const offline = createAtlas({ snapshot: JSON.parse(json), now: () => time });
  assert.deepEqual(offline.models(), atlas.models());
  assert.deepEqual(offline.explain('p', 'gpt-5.4-mini'), atlas.explain('p', 'gpt-5.4-mini'));
  assert.equal(offline.supports('p', 'gpt-5.4-mini', 'temperature'), false);
  assert.deepEqual(offline.toSnapshot(), snapshot);
  assert.equal(offline.isStale('missing'), true);
});
test('malformed snapshots cannot introduce unsafe fields or poison prototypes', () => {
  const atlas = createAtlas({ snapshot: { version: 1, sources: [{ source: 'provider:p', kind: 'provider', at: now().toISOString(), hostname: 'user:password@host.test?token=secret', models: [null, { provider: 'p', id: 'm', claims: { '__proto__.polluted': [{ value: true, source: 'override', via: 'x', at: now().toISOString() }], 'capabilities.tools': [{ value: null, source: 'endpoint', via: 'x', at: now().toISOString() }] }, apiKey: 'secret' }] }], additions: [] } });
  assert.equal(atlas.snapshotWarnings.length, 1);
  assert.equal(atlas.supports('p', 'm', 'tools'), undefined);
  assert.equal(JSON.stringify(atlas.toSnapshot()).includes('secret'), false);
  assert.deepEqual(createAtlas({ snapshot: { version: 99 } }).models(), []);
});
test('selection false vs unknown, provider filters, context, lifecycle and deterministic preference order', () => {
  const atlas = createAtlas({ now });
  for (const id of ['a', 'b', 'c', 'deprecated', 'retired']) {
    atlas.setOverride('p', id, 'limits.contextTokens', id === 'a' ? 100 : 200);
    atlas.setOverride('p', id, 'pricing', { currency: 'USD', inputPerMTok: id === 'a' ? 1 : 2, outputPerMTok: 1 });
    atlas.setOverride('p', id, 'releasedAt', id === 'a' ? '2025-01-01' : '2026-01-01');
    if (id !== 'c') atlas.setOverride('p', id, 'capabilities.tools', id !== 'b');
  }
  atlas.setOverride('p', 'deprecated', 'lifecycle', { status: 'deprecated' });
  atlas.setOverride('p', 'retired', 'lifecycle', { status: 'retired' });
  atlas.setOverride('q', 'a', 'capabilities.tools', true);
  assert.deepEqual(atlas.select({ requires: { tools: true }, providers: ['p'] }).map(c => c.model.id), ['a', 'deprecated']);
  const candidates = atlas.select({ requires: { tools: true }, providers: ['p'], allowUnknown: true, prefer: ['largestContext'] });
  assert.deepEqual(candidates.map(c => c.model.id), ['c', 'a', 'deprecated']);
  assert.deepEqual(candidates[0]?.unknown, ['tools']); assert.ok(candidates[0]!.score > candidates[1]!.score);
  assert.deepEqual(atlas.select({ requires: {}, providers: ['p'], minContextTokens: 150, exclude: ['b', { provider: 'p', id: 'deprecated' }], prefer: ['cheapest', 'newest'] }).map(c => c.model.id), ['c']);
  assert.equal(atlas.select({ requires: {}, prefer: [{ provider: 'q' }] })[0]?.model.provider, 'q');
  assert.equal(atlas.select({ requires: {}, providers: ['p'], prefer: ['newest'] })[0]?.model.id, 'b');
  assert.equal(atlas.select({ requires: {}, providers: ['p'], prefer: ['cheapest'] })[0]?.model.id, 'a');
  atlas.setOverride('p', 'a', 'lifecycle', { status: 'active', retiresAt: '2026-01-01' });
  assert.equal(atlas.select({ requires: {}, providers: ['p'] }).some(c => c.model.id === 'a'), false);
});
test('partial refresh failure retains prior records; successful refresh removes delisted models; cache errors reported', async () => {
  let failed = false; let include = true;
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }, { id: 'q', kind: 'openrouter' }], cache: { save() { throw new Error('SECRET'); } }, fetch: mock(url => {
    if (url.hostname === 'api.openai.com' && failed) throw new Error('SECRET');
    return { data: include ? [{ id: 'm' }] : [] };
  }) });
  assert.equal((await atlas.refresh()).at(-1)?.error, 'Cache save failed');
  failed = true; include = false;
  const reports = await atlas.refresh();
  assert.equal(reports[0]?.ok, false); assert.equal(reports[1]?.ok, true);
  assert.ok(atlas.model('p', 'm')); assert.equal(atlas.model('q', 'm'), undefined);
  assert.equal(JSON.stringify(reports).includes('SECRET'), false);
  failed = false; await atlas.refresh({ providers: ['p'], catalogs: [] }); assert.equal(atlas.model('p', 'm'), undefined);
});
test('concurrent refresh/probe calls serialize state updates', async () => {
  let active = 0, peak = 0;
  const atlas = createAtlas({ now, providers: [{ id: 'p', kind: 'openai' }], fetch: mock(async (_, init) => {
    active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return init.method === 'POST' ? reply('7381') : { data: [{ id: 'm' }] };
  }) });
  await Promise.all([atlas.refresh(), atlas.refresh(), atlas.probe('p', 'm', ['imageInput'])]);
  assert.equal(peak, 1); assert.equal(atlas.supports('p', 'm', 'imageInput'), true);
});
