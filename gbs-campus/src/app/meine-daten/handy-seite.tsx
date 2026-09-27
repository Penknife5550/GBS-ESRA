/**
 * GBS Campus — Seitenaufbau der Handy-Seiten (Teilnehmer und Dozenten)
 *
 * Oberflächenplan 09/2026, Vorlagen b1/b2: großer Titel wie in iOS-Apps, darüber
 * eine kleine Zeile (etwa das Semester), darunter Karten und Listen auf grauem
 * Grund. Am Rechner bleibt der Grund weiß und die Spalte wird breiter — dieselbe
 * Seite, keine eigene Variante.
 *
 * Lokal gebaut, weil der gemeinsame `Seitenkopf` (Werkzeugleiste mit Linie) die
 * Zeile ÜBER dem Titel nicht kennt. Genutzt von /meine-daten/** und /dozent/**.
 */

import type { ReactNode } from "react";
import { Inhalt } from "@/components/ui/seitenkopf";

/** Weiße Karte mit feinem Rand — auf dem grauen Grund am Handy wie in den Vorlagen. */
export const KARTE = "rounded-xl border border-linie bg-card p-4 lg:p-5";

/**
 * Grauer Grund für den Inhalt eines `Blatt` (wie die Vorlage b1-dozent-erfassen):
 * Kopf und Fuß des Blatts bleiben weiß, dazwischen weiße Gruppen auf Grau. Die
 * negativen Ränder heben den Innenabstand des Blatts auf.
 */
export const BLATT_GRUND = "-mx-5 -my-4 bg-muted px-4 py-4";

export function HandySeite({
  ueber,
  titel,
  children,
}: {
  /** Kleine Zeile über dem Titel, etwa „Herbstsemester 2026“. */
  ueber?: ReactNode;
  titel: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-w-0 bg-muted lg:bg-transparent">
      {/* Grauer Grund nur am Handy: zusätzlich als feste Fläche hinter allem,
          damit er auch unter der Leiste unten und bei kurzen Seiten bis zum
          Rand reicht. */}
      <div aria-hidden="true" className="fixed inset-0 -z-10 bg-muted lg:hidden" />
      <header className="px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        {ueber && <p className="text-[13px] font-medium text-muted-foreground">{ueber}</p>}
        <h1 className="text-[29px] font-bold leading-tight tracking-tight text-foreground lg:text-[28px]">{titel}</h1>
      </header>
      <Inhalt breite="lesen" className="pb-8 pt-4 lg:pt-5">
        {children}
      </Inhalt>
    </main>
  );
}
