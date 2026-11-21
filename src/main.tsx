import { createRoot } from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles/app.css";
import "./styles/answer-map.css";
import "./styles/citation-link.css";
import "./styles/evidence-reading.css";
import "./styles/grid-hover.css";
createRoot(document.getElementById("root")!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
