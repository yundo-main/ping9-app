import { createRoot } from "react-dom/client";
import "@ping9/editor/editor.css";
import { App } from "./app";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
