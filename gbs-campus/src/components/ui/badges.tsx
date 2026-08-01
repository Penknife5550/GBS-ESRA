/**
 * GBS Campus — Badges (Status, Teilnahmeform, Leistungsergebnis)
 *
 * Rein darstellend, kein "use client" — damit sowohl Server- als auch
 * Client-Komponenten sie einsetzen können. Die Tints stammen aus der CREDO-Linie;
 * der Text ist durchgehend `text-foreground` (nicht die Akzentfarbe), weil ein
 * roter Text auf rotem Tint den Kontrast nach WCAG AA verfehlt. Die Aussage trägt
 * immer das Wort, nicht allein die Farbe (WCAG 1.4.1).
 */

import type { ReactNode } from "react";
import { teilnahmeformName } from "@/lib/semester";
import { ergebnisName } from "@/lib/leistung";

const BASIS = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium";

export function Badge({ ton, children }: { ton?: string; children: ReactNode }) {
  return <span className={`${BASIS} ${ton ?? "bg-muted text-muted-foreground"}`}>{children}</span>;
}

/** Statuscode → Tint. Unbekannte Codes fallen neutral (bg-muted) zurück. */
const STATUS_TON: Record<string, string> = {
  INTERESSENT: "bg-credo-blau/12 text-foreground",
  ANGENOMMEN: "bg-credo-blau/15 text-foreground",
  AKTIV: "bg-credo-gruen/15 text-foreground",
  BEURLAUBT: "bg-credo-gelb/20 text-foreground",
  ABSOLVENT: "bg-primary/10 text-foreground",
  ABGEBROCHEN: "bg-muted text-muted-foreground",
  AUSGESCHLOSSEN: "bg-credo-rot/12 text-foreground",
  VERSTORBEN: "bg-muted text-muted-foreground",
  ANONYMISIERT: "bg-muted text-muted-foreground",
};

export function StatusBadge({ code, label }: { code: string; label: string }) {
  return <Badge ton={STATUS_TON[code]}>{label}</Badge>;
}

export function TeilnahmeformBadge({ form }: { form: string | null | undefined }) {
  const name = teilnahmeformName(form);
  if (!name) return null;
  const ton = form === "SCHUELER" ? "bg-credo-blau/12 text-foreground" : "bg-credo-gelb/20 text-foreground";
  return <Badge ton={ton}>{name}</Badge>;
}

const ERGEBNIS_TON: Record<string, string> = {
  BESTANDEN: "bg-credo-gruen/15 text-foreground",
  ERFOLGREICH_TEILGENOMMEN: "bg-credo-gruen/15 text-foreground",
  TEILGENOMMEN: "bg-credo-blau/12 text-foreground",
  NICHT_BESTANDEN: "bg-credo-rot/12 text-foreground",
};

export function ErgebnisBadge({ ergebnis }: { ergebnis: string }) {
  return <Badge ton={ERGEBNIS_TON[ergebnis]}>{ergebnisName(ergebnis)}</Badge>;
}
