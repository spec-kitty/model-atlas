import { createAtlas, modelsDev } from '../dist/index.js';

// Read the key from the process environment only. Never print config or raw HTTP errors.
const apiKey = process.env.COMPATIBLE_API_KEY;
if (!apiKey) {
  console.error('COMPATIBLE_API_KEY is required.');
  process.exitCode = 1;
} else {
  const atlas = createAtlas({
    providers: [
      { id: 'tokenfactory', kind: 'openai-compatible', baseUrl: 'https://gateway.trytokenfactory.dev/v1', apiKey },
      { id: 'openrouter', kind: 'openrouter' },
    ],
    catalogs: [modelsDev({ providerMap: { tokenfactory: null } })],
  });
  const reports = await atlas.refresh();
  for (const r of reports) console.log(`${r.source}: ${r.ok ? 'OK' : 'FAIL'}, models=${r.models}, skipped=${r.skipped}${r.error ? `, ${r.error}` : ''}`);
  // Concise gateway table; the full OpenRouter listing is represented by its count above.
  console.table(atlas.models('tokenfactory').map(m => ({
    model: m.id, vision: m.capabilities.imageInput?.value ?? '?', tools: m.capabilities.tools?.value ?? '?',
    reasoning: m.capabilities.reasoning?.value ?? '?', context: m.limits.contextTokens?.value ?? '?',
    visionSource: m.capabilities.imageInput?.source ?? '?',
  })));
  const expected = new Map([
    ...['kimi-k3', 'kimi-k3-abliterated', 'glm-5.3-flash', 'glm-5.3-flash-uncensored-fp8', 'minimax-m3.1-flash', 'deepseek-v4.1-flash-1017-uncensored-fp8'].map(id => [id, true]),
    ...['glm-5.3', 'glm-5.3-uncensored-fp8', 'deepseek-v4.1-flash-1017', 'nemotron-3-ultra', 'nemotron-3-super', 'nemotron-3.5-lightning'].map(id => [id, false]),
  ]);
  let failures = reports.filter(r => !r.ok).length;
  let passed = 0;
  for (const [id, value] of expected) {
    const actual = atlas.supports('tokenfactory', id, 'imageInput');
    if (actual === value) passed++;
    else { failures++; console.log(`Vision mismatch: ${id}: expected=${value}, actual=${actual ?? 'unknown'}`); }
  }
  console.log(`Vision ground truth: ${passed}/${expected.size} passed`);
  if (process.argv.includes('--probe')) {
    for (const [id, expected] of [['glm-5.3', false], ['kimi-k3', true]]) {
      const [report] = await atlas.probe('tokenfactory', id, ['imageInput']);
      console.log(`Probe ${id}: imageInput=${report?.value ?? 'unknown'}; expected=${expected}${report?.error ? `; ${report.error}` : ''}`);
      if (report?.value !== expected) failures++;
    }
  }
  console.log(`Smoke: ${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
  process.exitCode = failures ? 1 : 0;
}
