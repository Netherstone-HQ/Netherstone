import { useId } from "react";
import { MinusIcon, PlusIcon } from "@phosphor-icons/react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { type Preferences, useSettingsStore } from "@/store/settings";

/** A titled block of related settings. Rows sit together on one card. */
export function SettingsGroup({
  id,
  title,
  description,
  children,
  bare = false,
}: {
  id?: string;
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Draws the children without the card, for content with its own layout. */
  bare?: boolean;
}) {
  return (
    <section id={id} className="scroll-mt-8 space-y-3">
      {title ? (
        <div className="space-y-1 px-1">
          <h3 className="font-medium text-sm">{title}</h3>
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
      ) : null}
      {bare ? (
        children
      ) : (
        <div className="divide-y rounded-xl border bg-card shadow-xs">
          {children}
        </div>
      )}
    </section>
  );
}

/** One setting: what it is on the left, the control on the right. */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-6 px-4 py-3.5",
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <label htmlFor={htmlFor} className="block font-medium text-sm">
          {label}
        </label>
        {description ? (
          <p className="text-muted-foreground text-xs leading-5">
            {description}
          </p>
        ) : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

type BooleanKey = {
  [K in keyof Preferences]: Preferences[K] extends boolean ? K : never;
}[keyof Preferences];

/** A row with a switch bound to a yes/no preference. */
export function PreferenceSwitch({
  name,
  label,
  description,
  disabled,
}: {
  name: BooleanKey;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const value = useSettingsStore((s) => s[name]);
  const setPreference = useSettingsStore((s) => s.setPreference);

  return (
    <SettingRow label={label} description={description} htmlFor={id}>
      <Switch
        id={id}
        checked={value}
        disabled={disabled}
        onCheckedChange={(checked) => setPreference(name, checked)}
      />
    </SettingRow>
  );
}

export type Option<T extends string> = {
  value: T;
  label: string;
  /** Styles the option's label, e.g. to preview a font. */
  className?: string;
};

/** A row with a dropdown bound to a preference. */
export function PreferenceSelect<K extends keyof Preferences>({
  name,
  label,
  description,
  options,
  disabled,
}: {
  name: K;
  label: React.ReactNode;
  description?: React.ReactNode;
  options: Option<string>[];
  disabled?: boolean;
}) {
  const id = useId();
  const value = useSettingsStore((s) => s[name]);
  const setPreference = useSettingsStore((s) => s.setPreference);
  const isNumber = typeof value === "number";

  return (
    <SettingRow label={label} description={description} htmlFor={id}>
      <Select
        value={String(value)}
        disabled={disabled}
        onValueChange={(next) =>
          setPreference(
            name,
            (isNumber ? Number(next) : next) as Preferences[K],
          )
        }
      >
        <SelectTrigger id={id} size="sm" className="min-w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end">
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className={option.className}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

/** A compact row of mutually exclusive choices. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border bg-muted/50 p-0.5"
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-md px-3 py-1 text-muted-foreground text-xs transition-colors hover:text-foreground",
              checked && "bg-background text-foreground shadow-xs",
              option.className,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A row with a segmented control bound to a preference. */
export function PreferenceSegments<K extends keyof Preferences>({
  name,
  label,
  description,
  options,
}: {
  name: K;
  label: React.ReactNode;
  description?: React.ReactNode;
  options: Option<Preferences[K] & string>[];
}) {
  const value = useSettingsStore((s) => s[name]) as Preferences[K] & string;
  const setPreference = useSettingsStore((s) => s.setPreference);

  return (
    <SettingRow label={label} description={description}>
      <SegmentedControl
        label={typeof label === "string" ? label : String(name)}
        value={value}
        options={options}
        onChange={(next) => setPreference(name, next)}
      />
    </SettingRow>
  );
}

/** A number with − and + buttons either side. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const button =
    "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-lg border p-0.5"
    >
      <button
        type="button"
        aria-label="Fewer"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        className={button}
      >
        <MinusIcon className="size-3.5" />
      </button>
      <output
        aria-live="polite"
        className="min-w-6 text-center text-sm tabular-nums"
      >
        {value}
      </output>
      <button
        type="button"
        aria-label="More"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        className={button}
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  );
}
