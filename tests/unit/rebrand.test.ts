import { describe, expect, it } from 'vitest';
import { checklist, parseArgs, plannedUpdates, slugify } from '../../scripts/rebrand.mjs';

describe('rebrand helper', () => {
  it('slugifies organization names safely', () => {
    expect(slugify('River City Swing!')).toBe('river-city-swing');
  });
  it('parses required flags and plans derived names', () => {
    const args = parseArgs(['--name', 'Example Dance Club', '--short', 'Example', '--slug', 'example-dance', '--domain', 'https://www.example.org', '--email', 'info@example.org', '--region', 'Example County']);
    expect(plannedUpdates(args)).toMatchObject({ packageName: 'example-dance-website', shortName: 'Example', domain: 'https://www.example.org' });
  });
  it('prints the manual launch checklist', () => {
    expect(checklist({})).toContain('GitHub OAuth app');
    expect(checklist({})).toContain('photos your organization has permission to publish');
  });
});
