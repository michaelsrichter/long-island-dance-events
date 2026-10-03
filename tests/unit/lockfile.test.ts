import { describe, expect, it } from 'vitest';
import { toPublicUrl } from '../../scripts/normalize-lockfile.mjs';

describe('lockfile registry normalization', () => {
  it('rewrites Azure Artifacts mirror URLs to the public registry', () => {
    expect(toPublicUrl('https://contoso.pkgs.visualstudio.com/proj/_packaging/npm-public/npm/registry/@astrojs/check/-/check-0.9.10.tgz')).toBe(
      'https://registry.npmjs.org/@astrojs/check/-/check-0.9.10.tgz',
    );
    expect(toPublicUrl('https://pkgs.dev.azure.com/contoso/proj/_packaging/feed/npm/registry/yaml/-/yaml-2.8.1.tgz')).toBe('https://registry.npmjs.org/yaml/-/yaml-2.8.1.tgz');
  });
  it('rewrites generic proxy URLs and leaves public ones alone', () => {
    expect(toPublicUrl('https://artifactory.example.com/api/npm/npm-remote/sharp/-/sharp-0.35.0.tgz')).toBe('https://registry.npmjs.org/sharp/-/sharp-0.35.0.tgz');
    expect(toPublicUrl('https://registry.npmjs.org/astro/-/astro-7.3.5.tgz')).toBe('https://registry.npmjs.org/astro/-/astro-7.3.5.tgz');
  });
  it('does not touch non-tarball URLs such as git dependencies', () => {
    expect(toPublicUrl('git+https://github.com/example/repo.git#abc123')).toBeUndefined();
  });
});
