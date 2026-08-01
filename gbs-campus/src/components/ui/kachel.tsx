/**
 * GBS Campus — Dashboard-Kachel
 *
 * Eine klickbare Bereichs-Karte mit dezentem Linien-Icon, echter Kennzahl und
 * optionalem Handlungs-Pill (z. B. „3 neu") — die Kacheln der Verwaltungs-Übersicht.
 * (Die Dozenten-Übersicht nutzt eigene, nicht-klickbare KPI-Kacheln.)
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

export type PillTon = "blau" | "rot" | "gelb" | "gruen";

const PILL_TON: Record<PillTon, string> = {
  blau: "bg-credo-blau/12 text-foreground",
  rot: "bg-credo-rot/12 text-foreground",
  gelb: "bg-credo-gelb/20 text-foreground",
  gruen: "bg-credo-gruen/15 text-foreground",
};

export function Kachel({
  href,
  icon,
  titel,
  text,
  metric,
  pill,
}: {
  href: string;
  icon: IconName;
  titel: string;
  text: string;
  /** Echte Kennzahl statt Marketing; nur zeigen, wenn eine Zahl vorliegt. */
  metric?: ReactNode;
  pill?: { text: string; ton: PillTon };
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary"
    >
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-border bg-muted text-primary">
        <Icon name={icon} className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 font-semibold">
          {titel}
          {pill && (
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PILL_TON[pill.ton]}`}>
              {pill.text}
            </span>
          )}
        </span>
        <span className="mt-1 block text-sm text-muted-foreground">{text}</span>
        {metric != null && metric !== "" && (
          <span className="mt-1.5 block text-xs font-medium text-primary">{metric}</span>
        )}
      </span>
    </Link>
  );
}
