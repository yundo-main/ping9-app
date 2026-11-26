import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { EditorApp } from "@ping9/editor";
import "@ping9/editor/editor.css";

import { downloadText, listenTauriMenu } from "./file-platform";

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root 요소가 없습니다");
}

createRoot(root).render(
  <StrictMode>
    <EditorApp download={downloadText} onActions={listenTauriMenu} />
  </StrictMode>,
);
