import { readFileSync } from 'node:fs';
export const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
export const now = () => new Date('2026-11-01T12:00:00.000Z');
export function mock(handler: (url: URL, init: RequestInit) => unknown | Promise<unknown>): typeof fetch {
  return (async (input, init) => {
    const result = await handler(new URL(String(input)), init ?? {});
    return result instanceof Response ? result : Response.json(result);
  }) as typeof fetch;
}
export const reply = (content = 'OK') => ({ choices: [{ message: { content } }] });
