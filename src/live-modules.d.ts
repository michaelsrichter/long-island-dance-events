/**
 * Types for modules only the live server's build uses (src/lib/live-store.ts).
 */
declare module 'astro:asset-imports' {
  /** Astro's content pictures: "<stored path>?astroContentImageFlag=&importer=<content file>" -> picture. */
  const pictures: Map<string, unknown>;
  export default pictures;
}

declare module 'js-yaml' {
  /** The YAML reader Astro uses for .yml content files (a dependency of astro). */
  export function load(text: string, options?: { filename?: string }): unknown;
}
