import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    // DST and date-boundary tests must not depend on the machine's timezone.
    env: { TZ: 'Pacific/Kiritimati' },
  },
});
