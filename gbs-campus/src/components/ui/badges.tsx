/**
 * GBS Campus — Badges (Status, Teilnahmeform, Leistungsergebnis, Anmeldung,
 * Honorar-Abrechnung, Formularfassung, Anwesenheit)
 *
 * Rein darstellend, kein "use client" — damit sowohl Server- als auch
 * Client-Komponenten sie einsetzen können. Deshalb stammen die Klartexte aus
 * DB-freien Modulen (nie aus einem *-io.ts). Die Tints stammen aus der
 * CREDO-Linie; der Text ist durchgehend `text-foreground` (nicht die
 * Akzentfarbe), weil ein roter Text auf rotem Tint den Kontrast nach WCAG AA
 * verfehlt. Die Aussage trägt immer das Wort, nicht allein die Farbe
 * (WCAG 1.4.1).
 *
 * Vorher hielten Anmeldungen, Honorar-Abrechnungen und Formulare je eine eigene
 * Tint-Tabelle, die Schüler-Akte zeigte Anwesenheit und Noten als graue Pillen.
 */

import type { ReactNode } from "react";
import type { HonorarAbrechnungStatus } from "@prisma/client";
import { teilnahmeformName } from "@/lib/semester";
import { ergebnisName, giltAlsBestanden } from "@/lib/leistung";
import { abrechnungStatusText } from "@/lib/honorar";
import { anmeldestatusName } from "@/lib/anmeldestatus";
import { ANWESENHEIT, anwesenheitName } from "@/lib/stundenplan";

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

/** Ton eines Leistungsergebnisses. Was als bestanden zählt, entscheidet allein
 * `giltAlsBestanden` — keine eigene Liste der „grünen" Ergebnisse hier. */
function ergebnisTon(ergebnis: string): string | undefined {
  if (giltAlsBestanden(ergebnis)) return "bg-credo-gruen/15 text-foreground";
  if (ergebnis === "NICHT_BESTANDEN") return "bg-credo-rot/12 text-foreground";
  if (ergebnis === "TEILGENOMMEN") return "bg-credo-blau/12 text-foreground";
  return undefined;
}

export function ErgebnisBadge({ ergebnis }: { ergebnis: string }) {
  return <Badge ton={ergebnisTon(ergebnis)}>{ergebnisName(ergebnis)}</Badge>;
}

/** Bearbeitungsstand einer Anmeldung (Verwaltung: Liste und Einzelansicht). */
const ANMELDUNG_TON: Record<string, string> = {
  EINGEREICHT: "bg-credo-gelb/15 text-foreground",
  ANGENOMMEN: "bg-credo-gruen/15 text-foreground",
};

export function AnmeldungStatusBadge({ status }: { status: string }) {
  return <Badge ton={ANMELDUNG_TON[status]}>{anmeldestatusName(status)}</Badge>;
}

/** Tint je Abrechnungsstatus — exportiert für den verlinkten Chip der Übersicht. */
export const ABRECHNUNG_TON: Record<HonorarAbrechnungStatus, string> = {
  OFFEN: "bg-credo-gelb/15 text-foreground",
  FREIGEGEBEN: "bg-credo-blau/15 text-foreground",
  AUSGEZAHLT: "bg-credo-gruen/15 text-foreground",
};

export function AbrechnungStatusBadge({ status }: { status: HonorarAbrechnungStatus }) {
  return <Badge ton={ABRECHNUNG_TON[status]}>{abrechnungStatusText(status)}</Badge>;
}

/** Stand einer Formularfassung. ARCHIVIERT bleibt neutral. */
const FORMULAR_STATUS: Record<string, { name: string; ton?: string }> = {
  ENTWURF: { name: "Entwurf", ton: "bg-credo-gelb/15 text-foreground" },
  VEROEFFENTLICHT: { name: "Veröffentlicht", ton: "bg-credo-gruen/15 text-foreground" },
  ARCHIVIERT: { name: "Archiviert" },
};

export function FormularStatusBadge({ status }: { status: string }) {
  const eintrag = FORMULAR_STATUS[status];
  return <Badge ton={eintrag?.ton}>{eintrag?.name ?? status}</Badge>;
}

/** Anwesenheit an einem Abend. Ein Abend ohne Eintrag heißt „noch offen" (neutral). */
const ANWESENHEIT_TON: Record<string, string> = {
  [ANWESENHEIT.ANWESEND]: "bg-credo-gruen/15 text-foreground",
  [ANWESENHEIT.NACHGEARBEITET]: "bg-credo-gruen/15 text-foreground",
  [ANWESENHEIT.ENTSCHULDIGT]: "bg-credo-gelb/20 text-foreground",
  [ANWESENHEIT.GEFEHLT]: "bg-credo-rot/12 text-foreground",
};

export function AnwesenheitBadge({ status, vorsatz }: { status: string | null; vorsatz?: string }) {
  return (
    <Badge ton={status ? ANWESENHEIT_TON[status] : undefined}>
      {vorsatz}
      {status ? anwesenheitName(status) : "noch offen"}
    </Badge>
  );
}
