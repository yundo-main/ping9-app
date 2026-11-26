import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Vercel 정적 배포 — 상대 경로로 자산이 붙는다
  base: "./",
});
