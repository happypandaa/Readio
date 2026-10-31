import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PORT');
  return {
    esbuild: { jsx: 'automatic' },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: { '/v1': `http://127.0.0.1:${process.env.PORT || env.PORT || 8787}` },
    },
  };
});
