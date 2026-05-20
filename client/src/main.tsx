import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import App from "./App";
import "./index.css";

if (Capacitor.getPlatform() === "ios") {
  document.documentElement.classList.add("capacitor-ios");
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
}

createRoot(document.getElementById("root")!).render(<App />);
