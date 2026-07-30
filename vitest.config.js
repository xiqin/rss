import { defineConfig } from 'vitest/config';

const isWindows = process.platform === 'win32';

export default defineConfig({
  test: {
    globals: true,
    // Windows 下文件系统和 worker 调度波动更大，给真实 workflow e2e 留出余量。
    testTimeout: isWindows ? 60000 : 10000,
    hookTimeout: isWindows ? 60000 : 10000,
    pool: isWindows ? 'threads' : 'forks',
    maxWorkers: isWindows ? 4 : undefined,
    setupFiles: ['./vitest.setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: [
        'src/**/*.js',
        'hooks/**/*.js',
      ],
      exclude: [
        'src/generated/**',
        'scripts/**',
        'tests/**',
        'vitest.config.js',
        'vitest.setup.js',
      ],
    },
  },
});
