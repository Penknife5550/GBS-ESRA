/**
 * GBS Campus — Bausteine der Personenakte (/verwaltung/personen/[id])
 *
 * Die Leseansicht aus dem Oberflächenplan 09/2026 („Lesen wie eine
 * Visitenkarte“): Kopf mit Initialen, Name und Stand in einer Zeile; Angaben
 * als ruhige Zeilen (Beschriftung über dem Wert), Noten und Verlauf als Listen.
 * Rein darstellend, Server-Komponenten.
 */

import type { ReactNode } from "react";
import { Gruppe } from "@/components/ui/liste";
import { StatusPunkt } from "@/components/ui/status-punkt";
import type { LeistungWert } from "@/lib/leistung";
import { initialen } from "@/lib/navigation";
import { ergebnisText, ergebnisTon, personStatusTon } from "./akte-anzeige";

export function AkteKopf({
  vorname,
  nachname,
  status,
  teilnahmeform,
  seit,
  email,
}: {
  vorname: string;
  nachname: string;
  status: { code: string; bezeichnung: string };
  /** „Schüler“, „Hörer“ oder leer. */
  teilnahmeform: string;
  /** Angelegt am, „TT.MM.JJJJ“. */
  seit: string;
  email: string;
}) {
  return (
    <div className="flex items-center gap-4 sm:gap-[18px]">
      <span
        aria-hidden="true"
        className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-input text-[19px] font-semibold text-foreground"
      >
        {initialen(vorname, nachname)}
      </span>
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-[26px]">
          {vorname} {nachname}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-0.5 text-sm text-muted-foreground">
          <StatusPunkt ton={personStatusTon(status.code)}>{status.bezeichnung}</StatusPunkt>
          {teilnahmeform && <span>{teilnahmeform}</span>}
          <span>seit {seit}</span>
          <span className="min-w-0 break-all">{email}</span>
        </div>
      </div>
    </div>
  );
}

/** Eine Angabe: kleine Beschriftung über dem Wert („Telefon“ / „030 …“). */
export function Angabe({ label, children, leise = false }: { label: ReactNode; children: ReactNode; leise?: boolean }) {
  return (
    <div className="min-h-12 px-4 py-2.5">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className={`break-words text-sm font-medium ${leise ? "text-muted-foreground" : "text-foreground"}`}>{children}</div>
    </div>
  );
}

/** Eine Gruppe mit nur einem Satz — für Stände ohne Liste („Nicht eingeschrieben.“). */
export function GruppenText({ children }: { children: ReactNode }) {
  return (
    <Gruppe>
      <p className="px-4 py-3.5 text-sm text-muted-foreground">{children}</p>
    </Gruppe>
  );
}

export type NotenZeile = { schluessel: string; fach: string; titel: string; wert: LeistungWert | null };

/** Noten je Fach, lesend: „noch nicht bewertet“ oder das Ergebnis mit Punkten und Note. */
export function NotenZeilen({ zeilen }: { zeilen: NotenZeile[] }) {
  return (
    <Gruppe>
      <ul className="divide-y divide-linie">
        {zeilen.map((z) => (
          <li
            key={z.schluessel}
            className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{z.fach}</p>
              <p className="text-[13px] text-muted-foreground">{z.titel}</p>
            </div>
            {z.wert ? (
              <StatusPunkt ton={ergebnisTon(z.wert.ergebnis)}>{ergebnisText(z.wert)}</StatusPunkt>
            ) : (
              <span className="text-sm text-muted-foreground">noch nicht bewertet</span>
            )}
          </li>
        ))}
      </ul>
    </Gruppe>
  );
}

export type VerlaufEintrag = {
  id: string;
  /** Status vorher; fehlt er, ist es der erste Eintrag („Angelegt als …“). */
  von: string | null;
  nach: string;
  datum: string;
  akteur: string | null;
  grund: string | null;
};

/** Die Statuswechsel, jüngster zuerst. */
export function VerlaufListe({ eintraege }: { eintraege: VerlaufEintrag[] }) {
  return (
    <Gruppe>
      <ul className="divide-y divide-linie">
        {eintraege.map((e) => (
          <li key={e.id} className="min-h-12 px-4 py-2.5">
            <p className="text-sm font-medium text-foreground">
              {e.von ? (
                <>
                  {e.von}
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> zu </span>
                  {e.nach}
                </>
              ) : (
                `Angelegt als ${e.nach}`
              )}
            </p>
            <p className="text-[13px] text-muted-foreground">{[e.datum, e.akteur].filter(Boolean).join(" · ")}</p>
            {e.grund && <p className="mt-0.5 break-words text-[13px] text-muted-foreground">{e.grund}</p>}
          </li>
        ))}
      </ul>
    </Gruppe>
  );
}
