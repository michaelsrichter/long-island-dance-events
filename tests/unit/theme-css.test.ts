import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');

/** Custom properties declared directly inside the first block that follows `selector {`. */
function declarations(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThan(-1);
  const body = css.slice(start + selector.length + 2, css.indexOf('}', start));
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

describe('light and dark mode colors', () => {
  const device = declarations(":root:not([data-theme='light'])");
  const chosen = declarations(":root[data-theme='dark']");

  it('uses the same dark colors whether dark comes from the device or the visitor’s choice', () => {
    expect(device.size).toBeGreaterThan(20);
    expect(Object.fromEntries(chosen)).toEqual(Object.fromEntries(device));
  });

  it('only overrides colors that the light theme defines', () => {
    const light = declarations(':root');
    for (const name of device.keys()) expect(light.has(name), name).toBe(true);
  });

  it('has no other dark-only rules that would ignore the visitor’s choice', () => {
    expect(css.match(/prefers-color-scheme/g)).toHaveLength(1);
  });
});
