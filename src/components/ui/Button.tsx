import { ButtonHTMLAttributes, forwardRef } from "react";
import { Loader2 } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

/** 단추 — 모양은 styles/app.css 의 .kd-btn (data-variant·data-size) */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", isLoading = false, disabled, className = "", children, ...props }, ref) => (
    // 처리 중에도 글자는 그대로 두고 앞에 도는 표시만 (폭이 튀지 않고, 화면 읽기는 "처리 중"을 듣는다)
    <button ref={ref} disabled={disabled || isLoading} aria-busy={isLoading || undefined} className={`kd-btn ${className}`} data-variant={variant} data-size={size} {...props}>
      {isLoading && <Loader2 size={14} className="kd-spin" aria-hidden="true" />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
