import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/layout.css";
import "@xterm/xterm/css/xterm.css";

const ua = navigator.userAgent;
document.documentElement.dataset.platform = /Mac|iPhone|iPad/.test(ua)
  ? "macos"
  : /Win/.test(ua)
    ? "windows"
    : "linux";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
