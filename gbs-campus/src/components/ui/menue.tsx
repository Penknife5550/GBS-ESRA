"use client";

/**
 * GBS Campus — Menü „…“
 *
 * Seltenes und Folgenreiches gehört aus dem Alltag heraus (Oberflächenplan
 * 09/2026): Anmeldelink, Datenauskunft oder Anonymisieren stehen nicht mehr als
 * Knopfreihe auf der Seite, sondern hinter „…“. Ohne Bibliothek gebaut:
 * Escape und ein Klick daneben schließen, Pfeiltasten wandern durch die
 * Einträge, der Fokus kehrt danach zum Auslöser zurück (WAI-ARIA Menu Button).
 */

import Link from "next/link";
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { knopf } from "./knopf";

export type MenuePunkt = {
  text: string;
  icon?: IconName;
  /** Führt zu einer Seite … */
  href?: string;
  /** … oder löst etwas aus (die Rückfrage stellt der Aufrufer selbst). */
  aktion?: () => void;
  /** Rot, für Folgenreiches wie Anonymisieren. */
  gefahr?: boolean;
  /** Trennlinie über diesem Eintrag. */
  trenner?: boolean;
  deaktiviert?: boolean;
};

export function Menue({
  punkte,
  label = "Weitere Aktionen",
  ausloeser,
  ausrichtung = "rechts",
  ausloeserKlasse,
}: {
  punkte: MenuePunkt[];
  label?: string;
  /** Eigener Inhalt des Auslösers; Standard ist „…“. */
  ausloeser?: ReactNode;
  ausrichtung?: "rechts" | "links" | "oben";
  ausloeserKlasse?: string;
}) {
  const [offen, setOffen] = useState(false);
  const wurzel = useRef<HTMLDivElement>(null);
  const knopfRef = useRef<HTMLButtonElement>(null);
  const liste = useRef<HTMLDivElement>(null);
  const id = useId();

  function schliessen(fokusZurueck = true) {
    setOffen(false);
    if (fokusZurueck) knopfRef.current?.focus();
  }

  useEffect(() => {
    if (!offen) return;
    function aussen(ereignis: MouseEvent) {
      if (!wurzel.current?.contains(ereignis.target as Node)) setOffen(false);
    }
    document.addEventListener("mousedown", aussen);
    // Erster Eintrag bekommt den Fokus, damit die Tastatur sofort weiterkommt.
    liste.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    return () => document.removeEventListener("mousedown", aussen);
  }, [offen]);

  function tasten(ereignis: KeyboardEvent<HTMLDivElement>) {
    const eintraege = Array.from(
      liste.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [],
    );
    const jetzt = eintraege.indexOf(document.activeElement as HTMLElement);
    if (ereignis.key === "Escape") {
      ereignis.preventDefault();
      schliessen();
    } else if (ereignis.key === "ArrowDown") {
      ereignis.preventDefault();
      eintraege[(jetzt + 1) % eintraege.length]?.focus();
    } else if (ereignis.key === "ArrowUp") {
      ereignis.preventDefault();
      eintraege[(jetzt - 1 + eintraege.length) % eintraege.length]?.focus();
    } else if (ereignis.key === "Tab") {
      setOffen(false);
    }
  }

  const lage =
    ausrichtung === "links" ? "left-0 top-full mt-1" : ausrichtung === "oben" ? "bottom-full left-0 mb-1" : "right-0 top-full mt-1";
  const eintragKlasse =
    "flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm lg:min-h-9 " +
    "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none aria-disabled:opacity-50";

  return (
    <div ref={wurzel} className="relative">
      <button
        ref={knopfRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={offen}
        aria-controls={offen ? id : undefined}
        aria-label={ausloeser ? undefined : label}
        onClick={() => setOffen((vorher) => !vorher)}
        className={
          ausloeserKlasse ??
          // Eigene Klassen statt knopf(): dort setzt sich `lg:px-3.5` gegen ein
          // angehängtes `lg:px-0` durch und quetscht das „…“ auf wenige Pixel.
          "grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-input bg-background text-foreground hover:bg-muted lg:h-9 lg:w-9"
        }
      >
        {ausloeser ?? <Icon name="mehr" className="h-5 w-5" />}
      </button>
      {offen && (
        <div
          ref={liste}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={tasten}
          className={`absolute z-40 w-64 rounded-xl border border-linie bg-background p-1 shadow-[0_10px_30px_rgb(0_0_0/0.14)] ${lage}`}
        >
          {punkte.map((punkt, i) => {
            const inhalt = (
              <>
                {punkt.icon && (
                  <Icon name={punkt.icon} className={`h-[18px] w-[18px] shrink-0 ${punkt.gefahr ? "text-credo-rot" : "text-muted-foreground"}`} />
                )}
                <span className={punkt.gefahr ? "text-credo-rot" : "text-foreground"}>{punkt.text}</span>
              </>
            );
            return (
              <Fragment key={`${punkt.text}-${i}`}>
                {punkt.trenner && <div role="separator" className="mx-2 my-1 border-t border-linie" />}
                {punkt.href && !punkt.deaktiviert ? (
                  <Link role="menuitem" href={punkt.href} className={eintragKlasse} onClick={() => setOffen(false)}>
                    {inhalt}
                  </Link>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    aria-disabled={punkt.deaktiviert || undefined}
                    className={eintragKlasse}
                    onClick={() => {
                      if (punkt.deaktiviert) return;
                      schliessen(false);
                      punkt.aktion?.();
                    }}
                  >
                    {inhalt}
                  </button>
                )}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
