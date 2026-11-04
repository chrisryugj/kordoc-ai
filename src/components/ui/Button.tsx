import { ButtonHTMLAttributes, forwardRef } from "react";

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
    <button ref={ref} disabled={disabled || isLoading} className={`kd-btn ${className}`} data-variant={variant} data-size={size} {...props}>
      {isLoading ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : children}
    </button>
  ),
);
Button.displayName = "Button";
