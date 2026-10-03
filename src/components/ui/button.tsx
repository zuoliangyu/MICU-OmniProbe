import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-45 disabled:saturate-[.35]",
          {
            "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90": variant === "default",
            "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90": variant === "destructive",
            "surface-control border border-border/70 hover:bg-accent hover:text-accent-foreground":
              variant === "outline",
            "bg-secondary text-secondary-foreground hover:bg-secondary/88": variant === "secondary",
            "hover:bg-muted hover:text-accent-foreground": variant === "ghost",
            "text-primary underline-offset-4 hover:underline": variant === "link",
          },
          {
            "h-9 px-3 py-2": size === "default",
            "h-8 rounded-lg px-2.5 text-xs": size === "sm",
            "h-10 rounded-lg px-6": size === "lg",
            "h-9 w-9 rounded-lg": size === "icon",
          },
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
