import { onReconnect, registerServiceWorker } from "pues/base/pwa";
import "pues/base/theme/install";
import { createRoot } from "react-dom/client";
import App from "./App";

onReconnect(() => {});
registerServiceWorker();

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
