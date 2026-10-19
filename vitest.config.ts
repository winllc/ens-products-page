import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Tests set the configuration they need; nothing leaks in from the
        // shell, CI or a Docker build's ARGs. See src/test/isolate-env.ts.
        setupFiles: ['src/test/isolate-env.ts'],
    },
});
