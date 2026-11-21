import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "SAGYODAI_");
  return {
    plugins: [react()],
    server: {
      port: Number(env.SAGYODAI_WEB_PORT ?? 5173),
      strictPort: true,
      proxy: { "/api": `http://127.0.0.1:${env.SAGYODAI_CORE_PORT ?? 4318}` },
    },
  };
});
