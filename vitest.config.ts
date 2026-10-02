import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          environment: 'node',
          include: ['shared/src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'backend',
          environment: 'node',
          include: ['backend/test/**/*.test.ts'],
          // Every file truncates the one test database, so they cannot overlap.
          fileParallelism: false,
          // Migrations on a cold database plus a real listener are slower than
          // the 5s default allows.
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
      // A path, not an inline block: the frontend tests need the app's own Vite
      // plugins, which live in frontend/vite.config.ts.
      './frontend',
    ],
  },
})
