/**
 * GBS Campus — Zurück-Leiste
 *
 * Der eine, überall gleiche Rückweg + eine optionale Krümelspur. Übernimmt exakt
 * die seit Beginn genutzte Back-Link-Optik (Unicode-„←", unterstrichen), damit die
 * neuen Seiten sich nicht von den bestehenden abheben. Kein Icon — bewusst, wie im
 * ganzen Projekt.
 */

import Link from "next/link";
import type { ReactNode } from "react";

export function ZurueckLeiste({
  href,
  label,
  breadcrumb,
}: {
  href: string;
  label: string;
  /** Optionale Krümelspur, z. B. „Verwaltung · Personen · Anna Muster". */
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Link href={href} className="text-sm text-muted-foreground underline underline-offset-4">
        ← {label}
      </Link>
      {breadcrumb && <span className="text-xs text-muted-foreground">{breadcrumb}</span>}
    </div>
  );
}
