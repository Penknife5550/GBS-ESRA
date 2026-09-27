/**
 * GBS Campus — Listen
 *
 * Gruppierte Listen wie in den Systemeinstellungen (Oberflächenplan 09/2026):
 * eine weiße Gruppe mit feinen Trennlinien statt einzelner Karten, feste
 * Zeilenhöhe, rechts ein Pfeil, wenn die Zeile weiterführt. So passen mehr
 * Einträge auf den Bildschirm, und das Auge findet die Kanten leichter.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

/** Überschrift über einer Gruppe, optional mit einem Link rechts („Stundenplan“). */
export function Abschnitt({
  titel,
  aktion,
  className = "",
}: {
  titel: ReactNode;
  aktion?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-2 mt-7 flex items-baseline gap-3 first:mt-0 ${className}`}>
      <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-dezent">{titel}</h2>
      {aktion && <div className="ml-auto text-[13px] font-medium text-primary">{aktion}</div>}
    </div>
  );
}

/** Weiße Gruppe mit Trennlinien zwischen den Zeilen. */
export function Gruppe({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`divide-y divide-linie overflow-hidden rounded-xl border border-linie bg-card ${className}`}>
      {children}
    </div>
  );
}

export type SymbolTon = "neutral" | "blau" | "gelb" | "rot" | "gruen";

const SYMBOL_TON: Record<SymbolTon, string> = {
  neutral: "bg-muted",
  blau: "bg-credo-blau/12",
  gelb: "bg-credo-gelb/20",
  rot: "bg-credo-rot/10",
  gruen: "bg-credo-gruen/15",
};

/** Kleines Symbol links in einer Zeile, auf einer zarten Farbfläche. */
export function Symbol({ icon, ton = "neutral" }: { icon: IconName; ton?: SymbolTon }) {
  return (
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${SYMBOL_TON[ton]}`} aria-hidden="true">
      <Icon name={icon} className="h-[18px] w-[18px] text-foreground" />
    </span>
  );
}

/**
 * Eine Zeile. Mit `href` wird sie zum Link und bekommt rechts einen Pfeil;
 * `rechts` nimmt Status, Zahl oder einen Knopf auf. Knöpfe gehören nicht in
 * eine verlinkte Zeile (verschachtelte Bedienelemente) — dann `href` weglassen.
 */
export function Zeile({
  href,
  symbol,
  titel,
  untertitel,
  rechts,
  children,
  className = "",
}: {
  href?: string;
  symbol?: ReactNode;
  titel?: ReactNode;
  untertitel?: ReactNode;
  rechts?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const inhalt = (
    <>
      {symbol}
      <div className="min-w-0 flex-1">
        {titel && <div className="truncate text-sm font-semibold text-foreground">{titel}</div>}
        {untertitel && <div className="truncate text-[13px] text-muted-foreground">{untertitel}</div>}
        {children}
      </div>
      {rechts && <div className="flex shrink-0 items-center gap-2">{rechts}</div>}
      {href && <Icon name="weiter" className="h-4 w-4 shrink-0 text-dezent" />}
    </>
  );
  const klassen = `flex min-h-12 items-center gap-3 px-4 py-2.5 ${className}`;
  return href ? (
    <Link href={href} className={`${klassen} hover:bg-muted/60 focus-visible:bg-muted/60`}>
      {inhalt}
    </Link>
  ) : (
    <div className={klassen}>{inhalt}</div>
  );
}

/** Beschriftung links, Wert rechts — für Stammdaten („Telefon · 030 …“). */
export function WertZeile({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-col justify-center gap-0.5 px-4 py-2 sm:flex-row sm:items-center sm:justify-start sm:gap-4">
      <div className="shrink-0 text-[13px] text-muted-foreground sm:w-36">{label}</div>
      <div className="min-w-0 text-sm text-foreground">{children}</div>
    </div>
  );
}
