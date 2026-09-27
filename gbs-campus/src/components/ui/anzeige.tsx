/**
 * GBS Campus — kleine Anzeigen: Kalenderblock, Balken, Ring
 *
 * Aus dem Oberflächenplan (09/2026): der nächste Abend als Kalenderblatt
 * („DI 29 Sept.“), die Anwesenheit als Balken mit Marke bei 80 % (Verwaltung)
 * oder als Ring (Teilnehmer am Handy). Rein darstellend; die Zahlen rechnet der
 * Aufrufer aus der vorhandenen Quote-Logik.
 */

import type { ReactNode } from "react";
import { kalenderTeile } from "@/lib/datum";

export function KalenderBlock({ datum, className = "" }: { datum: Date; className?: string }) {
  const { wochentag, tag, monat } = kalenderTeile(datum);
  return (
    <div className={`w-12 shrink-0 text-center leading-none ${className}`} aria-hidden="true">
      <div className="text-[11px] font-bold tracking-[0.08em] text-credo-rot">{wochentag}</div>
      <div className="mt-1 text-[26px] font-semibold tracking-tight text-foreground">{tag}</div>
      <div className="mt-1 text-xs text-muted-foreground">{monat}</div>
    </div>
  );
}

export type AnzeigeTon = "gruen" | "gelb" | "rot" | "grau";

const FUELLUNG: Record<AnzeigeTon, string> = {
  gruen: "bg-credo-gruen",
  gelb: "bg-credo-gelb",
  rot: "bg-credo-rot",
  grau: "bg-dezent",
};

/**
 * Balken von 0 bis `max`, gefüllt bis `wert`; `marke` zeichnet einen Strich
 * (etwa bei 16 von 20 = 80 %). `label` beschreibt den Balken für
 * Vorlesesoftware.
 */
export function Balken({
  wert,
  max,
  marke,
  ton = "gruen",
  label,
  className = "",
}: {
  wert: number;
  max: number;
  marke?: number;
  ton?: AnzeigeTon;
  label: string;
  className?: string;
}) {
  const anteil = (zahl: number) => (max > 0 ? Math.min(100, Math.max(0, (zahl / max) * 100)) : 0);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={wert}
      className={`relative h-1.5 w-full rounded-full bg-feld ${className}`}
    >
      <div className={`absolute inset-y-0 left-0 rounded-full ${FUELLUNG[ton]}`} style={{ width: `${anteil(wert)}%` }} />
      {marke !== undefined && (
        <div className="absolute -inset-y-1 w-0.5 rounded bg-muted-foreground" style={{ left: `${anteil(marke)}%` }} />
      )}
    </div>
  );
}

/** Ring mit Zahl in der Mitte, etwa „3“ besuchte Einheiten von 20. */
export function Ring({
  wert,
  max,
  ton = "gruen",
  label,
  children,
  groesse = 60,
}: {
  wert: number;
  max: number;
  ton?: AnzeigeTon;
  label: string;
  children?: ReactNode;
  groesse?: number;
}) {
  const radius = 25;
  const umfang = 2 * Math.PI * radius;
  const anteil = max > 0 ? Math.min(1, Math.max(0, wert / max)) : 0;
  const farbe = { gruen: "text-credo-gruen", gelb: "text-credo-gelb", rot: "text-credo-rot", grau: "text-dezent" }[ton];
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={wert}
      className="relative grid shrink-0 place-items-center"
      style={{ width: groesse, height: groesse }}
    >
      <svg viewBox="0 0 60 60" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="30" cy="30" r={radius} fill="none" strokeWidth="7" className="stroke-feld" />
        <circle
          cx="30"
          cy="30"
          r={radius}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          stroke="currentColor"
          className={farbe}
          strokeDasharray={`${anteil * umfang} ${umfang}`}
        />
      </svg>
      <span className="relative text-sm font-semibold tabular-nums text-foreground">{children ?? wert}</span>
    </div>
  );
}
