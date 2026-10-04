import { createContext, useContext, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copy } from "./copy";

/** Where the flow is, for the step dots in every footer. */
export const StepProgress = createContext({ index: 0, total: 1 });

/**
 * Every step after the welcome: the title sits at the same height on each
 * one, the content scrolls if it has to, and the footer stays put with
 * Back on the left, the step dots in the middle and the step's action on
 * the right.
 */
export function Step({
  title,
  body,
  children,
  onBack,
  action,
}: {
  title: string;
  body?: string;
  children: ReactNode;
  onBack?: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6">
        <div className="onboarding-step mx-auto w-full max-w-md pt-[12vh] pb-10">
          <div className="mb-8 space-y-2">
            <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
            {body ? (
              <p className="text-muted-foreground text-sm leading-6">{body}</p>
            ) : null}
          </div>
          {children}
        </div>
      </div>

      <div className="px-6 pt-3 pb-6">
        <div className="mx-auto grid w-full max-w-md grid-cols-[1fr_auto_1fr] items-center">
          <div>
            {onBack ? (
              <Button variant="ghost" onClick={onBack} className="-ml-3">
                {copy.common.back}
              </Button>
            ) : null}
          </div>
          <StepDots />
          <div className="flex justify-end">{action}</div>
        </div>
      </div>
    </div>
  );
}

function StepDots() {
  const { index, total } = useContext(StepProgress);
  return (
    <div
      className="flex justify-center gap-1.5"
      role="img"
      aria-label={copy.common.stepLabel(index + 1, total)}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            i === index ? "w-4 bg-foreground" : "w-1.5 bg-muted-foreground/30",
          )}
        />
      ))}
    </div>
  );
}

/** A short line of supporting text inside a step. */
export function Hint({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      className={cn(
        "text-sm leading-6",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

/** A large choice: an icon, a title and one line under it. */
export function ChoiceCard({
  icon,
  title,
  description,
  selected = false,
  disabled = false,
  onClick,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-colors",
        selected ? "border-foreground/30" : "hover:border-foreground/20",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-expanded={children ? selected : undefined}
        className="flex w-full items-center gap-3 rounded-xl p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4.5">
          {icon}
        </span>
        <span className="min-w-0 space-y-0.5">
          <span className="block font-medium text-sm">{title}</span>
          <span className="block text-muted-foreground text-sm">{description}</span>
        </span>
      </button>
      {selected && children ? (
        <div className="onboarding-fade space-y-4 border-t px-4 py-4">{children}</div>
      ) : null}
    </div>
  );
}

/** A small label over a field or value, the same everywhere. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="block font-medium text-xs text-muted-foreground">{children}</span>;
}
