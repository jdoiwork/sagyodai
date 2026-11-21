import { createRoot } from "react-dom/client";
import App from "./app/App";
import { ProjectProvider } from "./app/ProjectContext";
import "@xyflow/react/dist/style.css";
import "./app/styles.css";
createRoot(document.getElementById("root")!).render(
  <ProjectProvider>
    <App />
  </ProjectProvider>,
);
