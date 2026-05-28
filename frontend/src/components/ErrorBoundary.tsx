import React from "react";

interface ErrorBoundaryProps {
  /** Short label shown in the fallback UI (e.g. "Scene", "Task Monitor"). */
  label: string;
  /** Optional custom fallback. Receives the caught error and a reset fn. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  /** Optional class on the default fallback container. */
  className?: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Class component because React still requires class-based error boundaries
// (no hooks equivalent as of React 19). Used to isolate the Three.js canvas
// and modal subtrees so one crash doesn't blank the whole app.
export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info);
  }

  reset = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div
        role="alert"
        className={
          this.props.className ??
          "flex h-full w-full items-center justify-center bg-slate-950/80 p-6 text-center text-white"
        }
      >
        <div className="max-w-md space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-rose-300/80">
            {this.props.label} crashed
          </div>
          <p className="text-sm text-white/80">{error.message}</p>
          <button
            type="button"
            onClick={this.reset}
            className="rounded-md bg-white/12 px-3 py-1.5 text-[12px] font-semibold text-white/90 transition hover:bg-white/20"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
