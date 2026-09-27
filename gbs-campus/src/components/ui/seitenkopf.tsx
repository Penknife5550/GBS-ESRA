/**
 * GBS Campus — Seitenkopf
 *
 * Die Werkzeugleiste oben auf jeder Seite (Oberflächenplan 09/2026): links der
 * Titel, daneben Umschalter oder Filter, rechts die Aktionen, darunter eine
 * feine Linie. Am Handy steht der Titel groß über allem. Ein Rückweg
 * („‹ Personen“) ersetzt auf Unterseiten die frühere Zurück-Leiste; auf den
 * Hauptseiten braucht es keinen, dort führt die Leiste links.
 *
 * Ohne `titel` zeigt der Kopf nur Rückweg und Aktionen — für Seiten, die ihren
 * Namen groß im Inhalt tragen (etwa die Personenakte).
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";

export function Seitenkopf({
  titel,
  untertitel,
  zurueck,
  aktionen,
  children,
}: {
  titel?: ReactNode;
  untertitel?: ReactNode;
  zurueck?: { href: string; text: string };
  aktionen?: ReactNode;
  /** Umschalter oder Filter neben dem Titel, z. B. ein `Segment`. */
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-linie bg-background px-4 pb-3 pt-4 sm:px-6 lg:px-8 lg:py-0">
      <div className="flex flex-col gap-3 lg:min-h-14 lg:flex-row lg:items-center lg:gap-4 lg:py-2.5">
        {(zurueck || titel) && (
          <div className="flex min-w-0 flex-col gap-1 lg:flex-row lg:items-center lg:gap-4">
            {zurueck && (
              <Link
                href={zurueck.href}
                className="-ml-1 inline-flex w-fit items-center gap-0.5 rounded-md px-1 text-sm font-medium text-primary hover:bg-muted"
              >
                <Icon name="zurueck" className="h-4 w-4" />
                {zurueck.text}
              </Link>
            )}
            {titel && (
              <div className="min-w-0">
                <h1 className="text-[28px] font-bold leading-tight tracking-tight text-foreground lg:text-lg lg:font-semibold">
                  {titel}
                </h1>
                {untertitel && <p className="text-sm text-muted-foreground lg:hidden">{untertitel}</p>}
              </div>
            )}
            {titel && untertitel && <span className="hidden text-sm text-muted-foreground lg:inline">{untertitel}</span>}
          </div>
        )}
        {children && <div className="min-w-0 lg:flex-1">{children}</div>}
        {aktionen && <div className="flex flex-wrap items-center gap-2 lg:ml-auto lg:flex-nowrap">{aktionen}</div>}
      </div>
    </header>
  );
}

/**
 * Der Inhaltsbereich unter dem Seitenkopf mit den gemeinsamen Rändern. `breite`
 * begrenzt Lesetexte („lesen“, etwa eine Anmeldung) oder lässt Listen und
 * Tabellen die ganze Breite nutzen („voll“).
 */
export function Inhalt({
  children,
  breite = "voll",
  className = "",
}: {
  children: ReactNode;
  breite?: "voll" | "mittel" | "lesen";
  className?: string;
}) {
  const max = breite === "lesen" ? "max-w-3xl" : breite === "mittel" ? "max-w-5xl" : "";
  return <div className={`px-4 py-5 sm:px-6 lg:px-8 lg:py-6 ${max} ${className}`}>{children}</div>;
}
