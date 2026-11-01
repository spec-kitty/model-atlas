import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAtlas } from '../src/index.ts';
import type { ProbeCapability } from '../src/index.ts';
import { mock, now, reply } from './helpers.ts';

const provider = { id: 'p', kind: 'openai-compatible' as const, baseUrl: 'https://gateway.test/v1' };
test('opt-in image probe embeds PNG and checks visible number; no probes during refresh', async () => {
  let posts = 0;
  const atlas = createAtlas({ providers: [provider], now, fetch: mock((url, init) => {
    if (init.method !== 'POST') return { data: [{ id: 'yes' }, { id: 'no' }] };
    posts++; assert.equal(url.pathname, '/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    assert.ok(body.max_tokens <= 64); assert.ok(body.messages[0].content[1].image_url.url.startsWith('data:image/png;base64,iVBOR'));
    return reply(body.model === 'yes' ? '7381' : '1234');
  }) });
  await atlas.refresh(); assert.equal(posts, 0);
  const yes = await atlas.probe('p', 'yes', ['imageInput']); const no = await atlas.probe('p', 'no', ['imageInput']);
  assert.equal(yes[0]?.value, true); assert.equal(no[0]?.value, false);
  assert.equal(atlas.supports('p', 'yes', 'imageInput'), true);
  assert.equal(atlas.supports('p', 'no', 'imageInput'), false);
});
test('tools, structured output and sampling requests', async () => {
  const atlas = createAtlas({ providers: [provider], now, fetch: mock((_, init) => {
    const b = JSON.parse(String(init.body)); assert.ok(b.max_tokens <= 64);
    if (b.tools) { assert.equal(b.tool_choice, 'required'); return { choices: [{ message: { tool_calls: [{ function: { name: 'ping', arguments: '{}' } }] } }] }; }
    if (b.response_format) { assert.equal(b.response_format.type, 'json_schema'); return reply('{"ok":true}'); }
    assert.ok(b.temperature === 0.5 || b.top_p === 0.9); return reply();
  }) });
  atlas.setOverride('p', 'm', 'capabilities.toolChoice', true);
  for (const cap of ['tools', 'structuredOutput', 'temperature', 'topP'] satisfies ProbeCapability[]) {
    assert.equal((await atlas.probe('p', 'm', [cap]))[0]?.value, true); assert.equal(atlas.supports('p', 'm', cap), true);
  }
});
test('Anthropic probes use native messages, image blocks, tool choice and output_config', async () => {
  const seen: Record<string, unknown>[] = [];
  const atlas = createAtlas({ providers: [{ id: 'p', kind: 'anthropic', apiKey: 'secret' }], now, fetch: mock((url, init) => {
    assert.equal(url.pathname, '/v1/messages'); assert.equal(new Headers(init.headers).get('x-api-key'), 'secret');
    const body = JSON.parse(String(init.body)); seen.push(body);
    if (body.tools) { assert.deepEqual(body.tool_choice, { type: 'any' }); return { type: 'message', content: [{ type: 'tool_use', name: 'ping', input: {} }] }; }
    if (body.output_config?.format) return { type: 'message', content: [{ type: 'text', text: '{"ok":true}' }] };
    return { type: 'message', content: [{ type: 'text', text: '7381' }] };
  }) });
  assert.ok((await atlas.probe('p', 'm', ['imageInput', 'tools', 'structuredOutput', 'temperature', 'topP', { capability: 'reasoning', efforts: ['low'] }])).every(r => r.value === true));
  const first = seen[0] as { messages: Array<{ content: Array<{ source?: { type: string; media_type: string } }> }> };
  assert.equal(first.messages[0]?.content[1]?.source?.type, 'base64');
  assert.deepEqual(seen.at(-1)?.output_config, { effort: 'low' });
});
test('reasoning effort rejection removes only tested level; transient failures preserve evidence', async () => {
  const atlas = createAtlas({ providers: [provider], now, fetch: mock((_, init) => {
    const b = JSON.parse(String(init.body));
    if (b.reasoning_effort === 'high') return new Response('rejected', { status: 400 });
    if (b.reasoning_effort === 'medium') return new Response('rate limited', { status: 429 });
    return reply();
  }) });
  const reports = await atlas.probe('p', 'm', [{ capability: 'reasoning', efforts: ['low', 'high', 'medium'] }]);
  assert.deepEqual(reports.map(r => r.value), [true, false, undefined]);
  assert.equal(atlas.supports('p', 'm', 'reasoning'), true);
  assert.deepEqual(atlas.model('p', 'm')?.reasoning?.efforts?.value, ['low']);
  assert.equal(atlas.explain('p', 'm')?.claims['reasoning.efforts']?.length, 2);
});
for (const status of [401, 403, 429, 500, 503]) test(`HTTP ${status} never produces any probe claim`, async () => {
  const atlas = createAtlas({ providers: [provider], now, fetch: mock(() => new Response('temperature top_p reasoning_effort SECRET', { status })) });
  const reports = await atlas.probe('p', 'm', ['imageInput', 'tools', 'structuredOutput', 'temperature', 'topP', 'reasoning']);
  assert.ok(reports.every(r => r.value === undefined && r.ok === false)); assert.equal(atlas.model('p', 'm'), undefined);
  assert.equal(JSON.stringify(reports).includes('SECRET'), false);
});
test('400/422 semantic rejections; unrelated sampling errors remain unknown', async () => {
  for (const [cap, status, text, expected] of [
    ['imageInput', 400, 'unsupported', false], ['imageInput', 422, 'unsupported', false], ['tools', 400, 'unsupported', false],
    ['structuredOutput', 422, 'unsupported', false], ['temperature', 400, 'temperature not supported', false],
    ['topP', 400, 'top_p unsupported', false], ['temperature', 400, 'model does not exist', undefined], ['tools', 422, 'oops', undefined],
  ] as const) {
    const atlas = createAtlas({ providers: [provider], now, fetch: mock(() => new Response(text, { status })) });
    assert.equal((await atlas.probe('p', 'm', [cap]))[0]?.value, expected);
    assert.equal(atlas.supports('p', 'm', cap), expected);
  }
});
test('timeout, network and malformed responses produce no claims', async () => {
  for (const fetch of [mock(() => { throw new Error('SECRET'); }), mock(() => new Promise(() => {})), mock(() => ({})), mock(() => new Response('{'))]) {
    const atlas = createAtlas({ providers: [provider], now, fetch, timeoutMs: 10 });
    const reports = await atlas.probe('p', 'm', ['imageInput']);
    assert.equal(reports[0]?.value, undefined); assert.equal(atlas.model('p', 'm'), undefined);
  }
});
test('invalid JSON output fails structured probe; no tool call is inconclusive', async () => {
  const atlas = createAtlas({ providers: [provider], now, fetch: mock(() => reply('plain text')) });
  assert.equal((await atlas.probe('p', 'm', ['structuredOutput']))[0]?.value, false);
  assert.equal((await atlas.probe('p', 'm', ['tools']))[0]?.value, undefined);
});
test('probe evidence and losing claims survive JSON snapshot round trip', async () => {
  let answer = '7381';
  const atlas = createAtlas({ providers: [provider], now, fetch: mock(() => reply(answer)) });
  await atlas.probe('p', 'm', ['imageInput']); answer = 'wrong'; await atlas.probe('p', 'm', ['imageInput']);
  const restored = createAtlas({ snapshot: JSON.parse(JSON.stringify(atlas.toSnapshot())), now });
  assert.deepEqual(restored.explain('p', 'm'), atlas.explain('p', 'm'));
  assert.equal(restored.supports('p', 'm', 'imageInput'), false);
  assert.deepEqual(restored.explain('p', 'm')?.claims['capabilities.imageInput']?.map(c => c.value), [true, false]);
});
