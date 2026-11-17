import { Component } from "react";
import type { ReactNode } from "react";

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error(error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="loadingPage" style={{ flexDirection: "column", gap: 14, minHeight: "100vh" }}>
        <strong>Something went wrong on this page.</strong>
        <button type="button" className="primaryButton" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
