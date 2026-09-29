import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * TooltipButton - A button with built-in tooltip support
 * Reduces repeated TooltipProvider/Tooltip/TooltipTrigger boilerplate
 */
export interface TooltipButtonProps extends ButtonProps {
  /** Tooltip content - can be string or ReactNode */
  tooltip: React.ReactNode;
  /** Icon to display in the button */
  icon?: React.ReactNode;
  /** Side of the button to show the tooltip */
  tooltipSide?: "top" | "right" | "bottom" | "left";
}

export function TooltipButton({ tooltip, icon, tooltipSide = "bottom", children, ...buttonProps }: TooltipButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* 图标按钮只有 tooltip 时，读屏器拿不到名称；字符串 tooltip 默认兼作 aria-label */}
        <Button aria-label={typeof tooltip === "string" ? tooltip : undefined} {...buttonProps}>
          {icon}
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>{typeof tooltip === "string" ? <p>{tooltip}</p> : tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * TooltipWrapper - Wrap any element with a tooltip
 * Use this when you need tooltip on non-button elements
 */
export interface TooltipWrapperProps {
  /** Tooltip content - can be string or ReactNode */
  tooltip: React.ReactNode;
  /** The element to wrap */
  children: React.ReactNode;
  /** Side to show the tooltip */
  side?: "top" | "right" | "bottom" | "left";
  /** Whether the child is a single React element (use asChild) */
  asChild?: boolean;
}

export function TooltipWrapper({ tooltip, children, side = "bottom", asChild = true }: TooltipWrapperProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild={asChild}>{children}</TooltipTrigger>
      <TooltipContent side={side}>{typeof tooltip === "string" ? <p>{tooltip}</p> : tooltip}</TooltipContent>
    </Tooltip>
  );
}
