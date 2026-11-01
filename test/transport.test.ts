import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAtlas } from '../src/index.ts';
import { makeTransport, RequestError } from '../src/transport.ts';
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

test('error attribution reads error fields, never echoed request parameters', async () => {
  for (const [body, parameter] of [
    [{ error: { message: 'Invalid max_tokens', request: { temperature: 0.5, top_p: 0.9, reasoning_effort: 'high' } } }, undefined],
    [{ error: { param: 'max_tokens', message: 'temperature not supported' } }, undefined],
    [{ error: { param: 'temperature', message: 'SECRET' } }, 'temperature'],
    [{ error: { message: 'top_p unsupported' }, request: { temperature: 0.5 } }, 'top_p'],
    [{ error: { message: 'Unsupported parameter: reasoning_effort' } }, 'reasoning_effort'],
    [{ error: { message: 'effort must be one of low, medium, high' } }, 'effort'],
    [{ error: { parameter: 'output_config.effort' } }, 'output_config.effort'],
    [{ error: { param: 'response_format.json_schema' } }, 'response_format'],
    [{ error: { message: 'Invalid max_tokens; request: temperature=0.5' } }, undefined],
    ['Invalid max_tokens; request: temperature=0.5', undefined],
    ['Invalid parameter: "temperature"', 'temperature'],
    ['temperature_limit unsupported', undefined],
  ] as const) {
    const request = makeTransport(mock(() => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 400 })), 1000, 4096);
    await assert.rejects(request(new URL('https://gateway.test'), new Headers()), error => {
      assert.ok(error instanceof RequestError); assert.equal(error.message, 'HTTP 400');
      assert.equal(error.parameter, parameter); return true;
    });
  }
});
