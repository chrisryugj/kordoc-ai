import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Copy, Check } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(_error: Error, info: React.ErrorInfo) {
    // 컴포넌트 스택 캡처 (에러 리포트용)
    if (info.componentStack) {
      this.setState((prev) => ({
        ...prev,
        error: prev.error
          ? Object.assign(prev.error, { componentStack: info.componentStack })
          : prev.error,
      }));
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, copied: false });
  };

  handleCopyError = async () => {
    if (!this.state.error) return;
    try {
      const err = this.state.error;
      const parts = [err.message];
      if (err.stack) parts.push('\n--- Stack ---\n' + err.stack);
      if ((err as Error & { componentStack?: string }).componentStack) {
        parts.push('\n--- Component ---\n' + (err as Error & { componentStack?: string }).componentStack);
      }
      await navigator.clipboard.writeText(parts.join(''));
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // clipboard API 미지원 시 무시
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center h-full p-8 select-none"
          role="alert"
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
            style={{ backgroundColor: "var(--color-error-subtle)" }}
          >
            <AlertTriangle size={32} style={{ color: "var(--color-error)" }} />
          </div>
          <h2
            className="ts-lg font-bold mb-2"
            style={{ color: "var(--color-text-primary)" }}
          >
            오류가 발생했습니다
          </h2>
          <p
            className="ts-sm mb-2 text-center max-w-md"
            style={{ color: "var(--color-text-muted)" }}
          >
            예상치 못한 오류가 발생했습니다. 아래 버튼을 클릭하여 다시 시도하세요.
          </p>
          <p
            className="ts-2xs mb-4 text-center max-w-md"
            style={{ color: "var(--color-text-muted)", opacity: 0.7 }}
          >
            문제가 반복되면 오류 내용을 복사하여 관리자에게 전달해 주세요.
          </p>
          {this.state.error && (
            <div className="relative max-w-lg w-full mb-4">
              <pre
                className="ts-2xs text-mono p-3 rounded-lg overflow-auto"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-muted)",
                  maxHeight: 120,
                }}
              >
                {this.state.error.message}
              </pre>
              <button
                onClick={this.handleCopyError}
                className="absolute top-2 right-2 p-1 rounded transition-colors"
                style={{ color: "var(--color-text-muted)" }}
                title="오류 내용 복사"
                aria-label="오류 내용 복사"
              >
                {this.state.copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          )}
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-4 py-2 rounded-lg ts-sm font-semibold transition-colors"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
          >
            <RotateCcw size={16} /> 다시 시도
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
