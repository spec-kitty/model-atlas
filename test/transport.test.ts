import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAtlas } from '../src/index.ts';
import { mock } from './helpers.ts';

test('size limits enforce advertised and actual streamed bytes', async () => {
  for (const response of [new Response('small', { headers: { 'content-length': '99999' } }), new Response('x'.repeat(101)),
    new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(60)); c.enqueue(new Uint8Array(60)); c.close(); } }))]) {
    const atlas = createAtlas({ providers: [{ id: 'p', kind: 'openai' }], maxResponseBytes: 100, fetch: mock(() => response) });
    assert.equal((await atlas.refresh())[0]?.error, 'Response too large'); assert.deepEqual(atlas.models(), []);
  }
});
test('timeout covers body reads, even injected fetch that ignores abort', async () => {
  const atlas = createAtlas({ providers: [{ id: 'p', kind: 'openai' }], timeoutMs: 10, fetch: mock(() => new Response(new ReadableStream({ start() {} }))) });
  assert.equal((await atlas.refresh())[0]?.error, 'Request timed out');
});
test('redirects disallowed; custom headers stay in request; no raw exception or error body retained', async () => {
  const atlas = createAtlas({ providers: [{ id: 'p', kind: 'openai', apiKey: 'TOP_SECRET' }], fetch: mock((_, init) => {
    assert.equal(init.redirect, 'error'); return new Response('TOP_SECRET', { status: 401 });
  }) });
  assert.deepEqual(await atlas.refresh(), [{ source: 'provider:p', ok: false, models: 0, skipped: 0, error: 'HTTP 401' }]);
});
