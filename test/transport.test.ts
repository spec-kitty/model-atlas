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
  let cancelled = false; let signal: AbortSignal | null | undefined;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const atlas = createAtlas({ providers: [{ id: 'p', kind: 'openai' }], timeoutMs: 10, fetch: mock((_, init) => {
    signal = init.signal; return new Response(body);
  }) });
  assert.equal((await atlas.refresh())[0]?.error, 'Request timed out');
  assert.equal(signal?.aborted, true); assert.equal(cancelled, true); assert.equal(body.locked, false);
});
test('redirects disallowed; custom headers stay in request; no raw exception or error body retained', async () => {
  const atlas = createAtlas({ providers: [{ id: 'p', kind: 'openai', apiKey: 'TOP_SECRET' }], fetch: mock((_, init) => {
    assert.equal(init.redirect, 'error'); return new Response('TOP_SECRET', { status: 401 });
  }) });
  assert.deepEqual(await atlas.refresh(), [{ source: 'provider:p', ok: false, models: 0, skipped: 0, error: 'HTTP 401' }]);
});

test('late fetch responses are cancelled and late rejections remain observed after timeout', async () => {
  for (const rejectLate of [false, true]) {
    let settle!: (response: Response) => void;
    let reject!: (error: Error) => void;
    const fetch = (() => new Promise<Response>((resolve, fail) => { settle = resolve; reject = fail; })) as typeof globalThis.fetch;
    const request = makeTransport(fetch, 10, 100);
    await assert.rejects(request(new URL('https://gateway.test'), new Headers()), /Request timed out/);
    let cancelled = false;
    if (rejectLate) reject(new Error('late failure'));
    else settle(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    await new Promise<void>(resolve => setImmediate(resolve));
    if (!rejectLate) assert.equal(cancelled, true);
    // node:test fails this test if a late rejection is unhandled.
  }
});

test('missing or invalid content lengths cannot bypass byte caps; null bodies are safe', async () => {
  for (const length of ['abc', '-1']) {
    for (const oversized of [false, true]) {
      const request = makeTransport(mock(() => new Response(oversized ? 'x'.repeat(101) : '{}', { headers: { 'content-length': length } })), 1000, 100);
      if (oversized) await assert.rejects(request(new URL('https://gateway.test'), new Headers()), /Response too large/);
      else assert.deepEqual(await request(new URL('https://gateway.test'), new Headers()), {});
    }
  }
  const request = makeTransport(mock(() => new Response(null)), 1000, 100);
  await assert.rejects(request(new URL('https://gateway.test'), new Headers()), /Invalid JSON response/);
  const response = new Response('{}');
  Object.defineProperty(response, 'body', { value: { getReader() { throw new Error('SECRET'); } } });
  await assert.rejects(makeTransport(mock(() => response), 1000, 100)(new URL('https://gateway.test'), new Headers()), /Network request failed/);
});

test('HTTP failures with empty, invalid or non-object JSON bodies expose only status', async () => {
  for (const body of [null, '', '{invalid SECRET', '[]', '"SECRET"', '42', 'true', 'null']) {
    const request = makeTransport(mock(() => new Response(body, { status: 400 })), 1000, 100);
    await assert.rejects(request(new URL('https://gateway.test'), new Headers()), error => {
      assert.ok(error instanceof RequestError); assert.equal(error.message, 'HTTP 400');
      assert.equal(error.parameter, undefined); return true;
    });
  }
});

test('common encoded secret echoes are scrubbed from claims, including offline restoration', async () => {
  const secret = 'private key/+with spaces';
  const echoes = [secret, encodeURIComponent(secret), new URLSearchParams({ v: secret }).toString().slice(2),
    encodeURIComponent(secret).replace(/%[0-9A-F]{2}/g, s => s.toLowerCase()),
    Buffer.from(secret).toString('base64'), Buffer.from(secret).toString('base64url')];
  const providers = [{ id: 'p', kind: 'openai' as const, apiKey: secret }];
  const atlas = createAtlas({ providers, fetch: mock(() => ({ data: echoes.map((name, i) => ({ id: `m${i}`, name })) })) });
  await atlas.refresh();
  for (const m of atlas.models()) assert.equal(m.displayName?.value, '[redacted]');
  const snapshot = atlas.toSnapshot();
  snapshot.sources[0]!.models[0]!.claims.displayName![0]!.value = echoes[2];
  const restored = createAtlas({ providers, snapshot });
  assert.equal(restored.model('p', 'm0')?.displayName?.value, '[redacted]');
});

test('error attribution reads error fields, never echoed request parameters', async () => {
  for (const [body, parameter] of [
    [{ error: { message: 'Invalid max_tokens', request: { temperature: 0.5, top_p: 0.9, reasoning_effort: 'high' } } }, undefined],
    [{ error: { param: 'max_tokens', message: 'temperature not supported' } }, undefined],
    [{ error: { param: 'temperature', message: 'SECRET' } }, 'temperature'],
    [{ error: { message: 'top_p unsupported' }, request: { temperature: 0.5 } }, 'top_p'],
    [{ error: { message: 'tool_choice is not supported' } }, 'tool_choice'],
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
