/**
 * GBS Campus — Rahmen der öffentlichen Seiten
 *
 * Anmelden, Hilfe, Passwort, Link bestätigen, die Rückmeldung zur Überleitung
 * und die Datenauskunft liegen außerhalb des App-Rahmens (keine Leiste). Sie
 * teilen sich eine ruhige, schmale Spalte (Oberflächenplan 09/2026, „Zwei klare
 * Wege“): oben ein Rückweg, ein Titel, ein Satz, darunter die eine Aufgabe der
 * Seite. Die CREDO-Linie darüber kommt aus dem Root-Layout.
 *
 * Liegt bei /anmelden, weil es keinen gemeinsamen Ordner der öffentlichen
 * Seiten gibt; das Anmeldeformular nimmt von hier die Feldklassen.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";

/** Beschriftung über einem Feld. */
export const FELD_TITEL = "mb-1.5 block text-[13px] font-medium text-muted-foreground";

/**
 * Eingabefeld ohne Höhe und Rahmenfarbe (die setzt der Aufrufer: `h-12
 * border-input`, bei Fehler `border-credo-rot`). 16 px Schrift: Das iPhone
 * zoomt beim Tippen sonst in die Seite hinein.
 */
export const FELD =
  "block w-full rounded-xl border bg-background px-4 text-base text-foreground placeholder:text-dezent disabled:opacity-60";

/** Textlink mit großer Tippfläche, etwa „Mit Passwort anmelden“ oder „Hilfe“. */
export const TEXTLINK =
  "inline-flex min-h-11 items-center text-[15px] font-medium text-primary underline-offset-4 hover:underline";

export function OeffentlicheSeite({
  zurueck,
  titel,
  satz,
  children,
  fuss,
}: {
  zurueck?: { href: string; text: string };
  titel: ReactNode;
  /** Ein Satz unter dem Titel — keine Absätze (Plan: Erklärungen nur, wo etwas zu tun ist). */
  satz?: ReactNode;
  children?: ReactNode;
  /** Kleiner Text ganz unten, am Handy am unteren Rand. */
  fuss?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-6px)] w-full max-w-md flex-col px-6 pb-10 pt-2 sm:pt-10">
      {zurueck ? (
        <Link
          href={zurueck.href}
          className="-ml-2 inline-flex h-11 w-fit items-center gap-0.5 rounded-lg pl-1 pr-2 text-base font-medium text-primary hover:bg-muted"
        >
          <Icon name="zurueck" className="h-5 w-5" />
          {zurueck.text}
        </Link>
      ) : (
        <div className="h-11" aria-hidden="true" />
      )}
      <h1 className="mt-6 hyphens-auto break-words text-[29px] font-bold leading-tight tracking-tight text-foreground">
        {titel}
      </h1>
      {satz && <p className="mt-2.5 text-base leading-relaxed text-muted-foreground">{satz}</p>}
      {children}
      {fuss && <div className="mt-auto pt-12 text-center text-sm text-muted-foreground sm:mt-0">{fuss}</div>}
    </main>
  );
}
