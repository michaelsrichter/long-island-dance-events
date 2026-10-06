/**
 * Astro adapter for the live server (decision P58): the site is built once more in "server" output, and the
 * Node server in server/src/main.js hands each page request to `handle(request)` from this entry point.
 * Static files (scripts, styles, fonts, images) are served by the Node server from the build's client folder.
 */
export default function liveServerAdapter() {
  return {
    name: 'li-live-server',
    hooks: {
      'astro:config:done': ({ setAdapter }) => {
        setAdapter({
          name: 'li-live-server',
          entrypointResolution: 'auto',
          serverEntrypoint: new URL('./entry.mjs', import.meta.url),
          supportedAstroFeatures: {
            serverOutput: 'stable',
            staticOutput: 'stable',
            hybridOutput: 'stable',
            sharpImageService: 'stable',
          },
          adapterFeatures: { buildOutput: 'server' },
        });
      },
    },
  };
}
