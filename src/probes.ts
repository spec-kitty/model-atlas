import type { ProbeCapability, ProbeReport, ProviderConfig } from './types.ts';
import { append, auth, baseUrl, object, RequestError } from './transport.ts';
import type { Transport } from './transport.ts';
import { probeImage } from './probe-image.ts';

export async function runProbe(config: ProviderConfig, model: string, capability: ProbeCapability, effort: string | undefined,
  requireTool: boolean, request: Transport): Promise<ProbeReport> {
  const report: ProbeReport = { capability, ...(effort === undefined ? {} : { effort }), ok: false };
  const anthropic = config.kind === 'anthropic';
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
  const body: Record<string, unknown> = { model, max_tokens: 64, messages: [{ role: 'user', content: 'Reply briefly: hello.' }] };
  if (capability === 'imageInput') {
    const text = { type: 'text', text: 'Reply with only the number in the image' };
    const image = anthropic ? { type: 'image', source: { type: 'base64', media_type: 'image/png', data: probeImage } }
      : { type: 'image_url', image_url: { url: `data:image/png;base64,${probeImage}` } };
    body.messages = [{ role: 'user', content: [text, image] }];
  } else if (capability === 'tools') {
    const parameters = { type: 'object', properties: {}, additionalProperties: false };
    body.messages = [{ role: 'user', content: 'Call the ping tool once.' }];
    body.tools = anthropic ? [{ name: 'ping', description: 'A trivial ping.', input_schema: parameters }]
      : [{ type: 'function', function: { name: 'ping', description: 'A trivial ping.', parameters } }];
    if (requireTool) body.tool_choice = anthropic ? { type: 'any' } : 'required';
  } else if (capability === 'structuredOutput') {
    body.messages = [{ role: 'user', content: 'Return JSON: {"ok":true}' }];
    if (anthropic) body.output_config = { format: { type: 'json_schema', schema } };
    else body.response_format = { type: 'json_schema', json_schema: { name: 'probe', strict: true, schema } };
  } else if (capability === 'temperature') body.temperature = 0.5;
  else if (capability === 'topP') body.top_p = 0.9;
  else if (anthropic) { body.thinking = { type: 'adaptive' }; body.output_config = { effort }; }
  else body.reasoning_effort = effort;
  try {
    let base = baseUrl(config);
    if (config.kind === 'fireworks' && !config.baseUrl) base = new URL('https://api.fireworks.ai/inference/v1');
    const r = object(await request(append(base, anthropic ? 'v1/messages' : 'chat/completions'), auth(config), body));
    const message = object(object(Array.isArray(r.choices) ? r.choices[0] : undefined).message);
    const blocks = Array.isArray(r.content) ? r.content.map(object) : [];
    const content = anthropic ? blocks.filter(b => b.type === 'text').map(b => b.text).filter(t => typeof t === 'string').join('') : message.content;
    const validResponse = anthropic ? r.type === 'message' || blocks.length > 0 : Array.isArray(r.choices) && r.choices.length > 0;
    if (!validResponse) return { ...report, error: 'Invalid probe response' };
    let value: boolean;
    if (capability === 'imageInput') {
      if (typeof content !== 'string') return { ...report, error: 'Missing probe reply' };
      value = content.includes('7381');
    } else if (capability === 'tools') {
      value = anthropic ? blocks.some(b => b.type === 'tool_use' && b.name === 'ping')
        : Array.isArray(message.tool_calls) && message.tool_calls.some(t => object(object(t).function).name === 'ping');
      if (!value) return { ...report, error: 'No tool call returned; inconclusive' };
    } else if (capability === 'structuredOutput') {
      if (typeof content !== 'string') return { ...report, error: 'Missing probe reply' };
      try { JSON.parse(content); value = true; } catch { value = false; }
    } else value = true;
    return { ...report, ok: true, value };
  } catch (error) {
    if (error instanceof RequestError) {
      const status = error.status;
      const rejected = status === 400 || status === 422;
      const definitive = (capability === 'imageInput' && rejected) || (capability === 'tools' && status === 400)
        || (['structuredOutput', 'reasoning'].includes(capability) && rejected)
        || (status === 400 && error.parameter === (capability === 'temperature' ? 'temperature' : capability === 'topP' ? 'top_p' : ''));
      if (definitive) return { ...report, ok: true, value: false };
      return { ...report, error: error.message };
    }
    return { ...report, error: 'Probe configuration failed' };
  }
}
