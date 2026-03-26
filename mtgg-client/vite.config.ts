import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE is set in GitHub Actions to /{repo-name}/
// Leave it as '/' for local dev and custom domain deploys.
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
});
