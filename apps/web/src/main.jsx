import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";
import "./capture.css";
import "./brand.css";

class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="loading"><h2>This view could not be loaded</h2><p>Your saved meetings are safe. Reload the workspace to continue.</p><button className="button primary" onClick={() => location.reload()}>Reload workspace</button></main>;
    return this.props.children;
  }
}
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </React.StrictMode>,
);

