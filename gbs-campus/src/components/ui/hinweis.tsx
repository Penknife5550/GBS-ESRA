/**
 * GBS Campus — Hinweis und leerer Zustand
 *
 * Erklärungen stehen dort, wo etwas zu tun ist, und nennen das Datum oder die
 * Zahl (Oberflächenplan 09/2026) — statt eines Absatzes über jeder Seite.
 * `Hinweis` ist die graue Zeile mit Symbol und optionaler Aktion,
 * `LeererZustand` füllt eine Liste ohne Einträge mit einem Satz und einem Weg
 * nach vorn (CLAUDE.md: nie leere Seiten).
 */

import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

export function Hinweis({
  icon = "hinweis",
  titel,
  children,
  aktion,
  className = "",
}: {
  icon?: IconName;
  titel?: ReactNode;
  children?: ReactNode;
  aktion?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-3 rounded-xl bg-muted px-4 py-3 sm:flex-row sm:items-center ${className}`}>
      <div className="flex min-w-0 flex-1 gap-3">
        <Icon name={icon} className="mt-0.5 h-[18px] w-[18px] shrink-0 text-muted-foreground" />
        <p className="min-w-0 text-sm text-muted-foreground">
          {titel && <span className="font-semibold text-foreground">{titel} </span>}
          {children}
        </p>
      </div>
      {aktion && <div className="shrink-0">{aktion}</div>}
    </div>
  );
}

export function LeererZustand({
  icon = "offen",
  titel,
  children,
  aktion,
}: {
  icon?: IconName;
  titel: ReactNode;
  children?: ReactNode;
  aktion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-linie px-6 py-10 text-center">
      <Icon name={icon} className="h-7 w-7 text-dezent" />
      <p className="text-[15px] font-semibold text-foreground">{titel}</p>
      {children && <p className="max-w-md text-sm text-muted-foreground">{children}</p>}
      {aktion && <div className="mt-2">{aktion}</div>}
    </div>
  );
}
