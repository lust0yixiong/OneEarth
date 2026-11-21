import { Component, type ReactNode } from "react";
import { rememberClientError } from "../domain/client-error";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    rememberClientError(error, "application");
  }

  render() {
    if (this.state.failed) return (
      <main className="loading-surface" role="alert">
        <section>
          <h1>页面暂时无法显示</h1>
          <p>重新载入页面后，可从历史会话继续查看资料。</p>
          <button onClick={() => location.reload()}>重新载入</button>
        </section>
      </main>
    );
    return this.props.children;
  }
}
