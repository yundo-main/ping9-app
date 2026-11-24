import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // Tauri 데스크톱 앱이라 산출물을 한 덩어리로 둔다. 로컬 파일이라 청크 분할 이득이 없다
    chunkSizeWarningLimit: 800,
  },
});
