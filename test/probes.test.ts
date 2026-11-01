import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAtlas } from '../src/index.ts';
import type { ProbeCapability, ProbeRequest } from '../src/index.ts';
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
    if (b.reasoning_effort === 'high') return new Response('reasoning_effort not supported', { status: 400 });
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
    ['structuredOutput', 422, 'response_format unsupported', false], ['temperature', 400, 'temperature not supported', false],
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
test('invalid JSON output and absent tool call are inconclusive', async () => {
  const atlas = createAtlas({ providers: [provider], now, fetch: mock(() => reply('plain text')) });
  const [report] = await atlas.probe('p', 'm', ['structuredOutput']);
  assert.equal(report?.value, undefined); assert.equal(report?.ok, false);
  assert.equal(report?.error, 'Invalid JSON in accepted response');
  assert.equal((await atlas.probe('p', 'm', ['tools']))[0]?.value, undefined);
  assert.equal(atlas.model('p', 'm'), undefined);
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

test('unrelated reasoning and structured-output rejections preserve published claims and snapshots', async () => {
  for (const kind of ['openai', 'anthropic'] as const) for (const status of [400, 422]) {
    for (const error of [
      { message: 'max_tokens must be >= 1024 when thinking is enabled', param: 'max_tokens' },
      { message: 'unknown field output_config' },
      { message: 'model not found' },
      { message: 'Invalid max_tokens', request: { reasoning_effort: 'high', output_config: { effort: 'high' }, response_format: {} } },
    ]) {
      const atlas = createAtlas({ providers: [{ id: 'p', kind }], now, fetch: mock((_, init) => init.method === 'POST'
        ? Response.json({ error }, { status }) : { data: [{ id: 'm', reasoning: { supported_efforts: ['high'] }, supported_parameters: ['response_format'] }] }) });
      await atlas.refresh();
      const before = atlas.toSnapshot();
      const reports = await atlas.probe('p', 'm', [{ capability: 'reasoning', efforts: ['high'] }, 'structuredOutput']);
      assert.ok(reports.every(r => !r.ok && r.value === undefined));
      assert.deepEqual(atlas.toSnapshot(), before);
    }
  }
});

test('parameter-specific reasoning rejection preserves unknown and can empty a known list', async () => {
  for (const kind of ['openai', 'anthropic'] as const) for (const baseline of [undefined, ['high']]) {
    const atlas = createAtlas({ providers: [{ id: 'p', kind }], now, fetch: mock((_, init) => init.method === 'POST'
      ? Response.json({ error: { param: kind === 'anthropic' ? 'output_config.effort' : 'reasoning_effort' } }, { status: 422 })
      : { data: [{ id: 'm', reasoning: { supported_efforts: baseline } }] }) });
    await atlas.refresh();
    assert.equal((await atlas.probe('p', 'm', [{ capability: 'reasoning', efforts: ['high'] }]))[0]?.value, false);
    assert.deepEqual(atlas.model('p', 'm')?.reasoning?.efforts?.value, baseline ? [] : undefined);
    assert.equal(atlas.supports('p', 'm', 'reasoning'), undefined);
    const restored = createAtlas({ snapshot: JSON.parse(JSON.stringify(atlas.toSnapshot())), now });
    assert.deepEqual(restored.model('p', 'm'), atlas.model('p', 'm'));
  }
});

test('reasoning defaults probe unknown and empty lists; published nonempty lists are used', async () => {
  for (const baseline of [undefined, [], ['max']]) {
    const seen: string[] = [];
    const atlas = createAtlas({ providers: [provider], now, fetch: mock((_, init) => {
      if (init.method !== 'POST') return { data: [{ id: 'm', reasoning: { supported_efforts: baseline } }] };
      seen.push(JSON.parse(String(init.body)).reasoning_effort); return reply();
    }) });
    await atlas.refresh();
    const reports = await atlas.probe('p', 'm', ['reasoning']);
    assert.deepEqual(seen, baseline?.length ? baseline : ['low', 'medium', 'high']);
    assert.equal(reports.length, seen.length); assert.ok(reports.every(r => r.value === true));
    assert.deepEqual(atlas.model('p', 'm')?.reasoning?.efforts?.value, seen);
  }
});

test('invalid effort arrays and unsupported capabilities report errors without requests', async () => {
  let calls = 0;
  const atlas = createAtlas({ providers: [provider], now, fetch: mock(() => { calls++; return reply(); }) });
  for (const efforts of ['high', undefined, null, {}, [], [undefined], [null], [1], new Array(1), ['High'], ['bad token'], ['x'.repeat(33)], Array(33).fill('low')]) {
    const reports = await atlas.probe('p', 'm', [{ capability: 'reasoning', efforts } as ProbeRequest]);
    assert.deepEqual(reports, [{ capability: 'reasoning', ok: false, error: 'Invalid effort levels' }]);
  }
  assert.deepEqual(await atlas.probe('p', 'm', ['streaming' as ProbeRequest]), [{ capability: 'streaming', ok: false, error: 'Unsupported probe' }]);
  assert.equal(calls, 0); assert.equal(atlas.model('p', 'm'), undefined);
});

test('tool probes force unknown tool choice and retry only choice rejections', async () => {
  const toolReply = { choices: [{ message: { tool_calls: [{ function: { name: 'ping' } }] } }] };
  for (const mode of ['accepted', 'rejected', 'no-call', 'unrelated', 'auth', 'known-false'] as const) {
    const bodies: Record<string, unknown>[] = [];
    const atlas = createAtlas({ providers: [{ id: 'p', kind: 'openai' }], now, fetch: mock((_, init) => {
      const body = JSON.parse(String(init.body)); bodies.push(body);
      if (body.tool_choice && mode !== 'accepted') return Response.json({ error: { param: mode === 'unrelated' ? 'max_tokens' : 'tool_choice' } }, { status: mode === 'auth' ? 401 : 400 });
      return mode === 'no-call' ? reply() : toolReply;
    }) });
    if (mode === 'known-false') atlas.setOverride('p', 'm', 'capabilities.toolChoice', false);
    const [report] = await atlas.probe('p', 'm', ['tools']);
    assert.equal(bodies[0]?.tool_choice, mode === 'known-false' ? undefined : 'required');
    assert.equal(bodies.length, ['rejected', 'no-call'].includes(mode) ? 2 : 1);
    if (bodies.length === 2) assert.equal(bodies[1]?.tool_choice, undefined);
    assert.equal(report?.value, ['accepted', 'rejected', 'known-false'].includes(mode) ? true : mode === 'unrelated' ? false : undefined);
  }
});

test('Fireworks probes remap default control plane, retaining custom inference bases', async () => {
  for (const [baseUrl, expected] of [
    [undefined, 'https://api.fireworks.ai/inference/v1/chat/completions'],
    ['https://api.fireworks.ai/v1', 'https://api.fireworks.ai/inference/v1/chat/completions'],
    ['https://api.fireworks.ai/v1/?route=x', 'https://api.fireworks.ai/inference/v1/chat/completions?route=x'],
    ['https://api.fireworks.ai/inference/v1', 'https://api.fireworks.ai/inference/v1/chat/completions'],
    ['https://proxy.test/v1', 'https://proxy.test/v1/chat/completions'],
  ]) {
    const atlas = createAtlas({ providers: [{ id: 'p', kind: 'fireworks', ...(baseUrl ? { baseUrl } : {}) }], now,
      fetch: mock(url => { assert.equal(url.href, expected); return reply('7381'); }) });
    assert.equal((await atlas.probe('p', 'm', ['imageInput']))[0]?.value, true);
  }
});
