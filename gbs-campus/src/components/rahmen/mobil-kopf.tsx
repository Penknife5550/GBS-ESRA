"use client";

/**
 * GBS Campus — Kopfzeile der Verwaltung am Handy
 *
 * Die Leiste links passt am Handy nicht; ihr Inhalt öffnet sich hinter dem
 * Menü-Knopf als Blatt von links (natives `<dialog>`: Fokusfalle und Escape
 * übernimmt der Browser). Ein Klick auf einen Bereich schließt es wieder.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { LeistenNavigation, type LeistenGruppe } from "./leisten-navigation";

export function MobilKopf({
  gruppen,
  unten,
  marke,
  suche,
  profil,
  offeneAufgaben,
}: {
  gruppen: LeistenGruppe[];
  unten?: LeistenGruppe;
  marke: ReactNode;
  suche?: ReactNode;
  /** Profil mit „Meine Daten“ und „Abmelden“ — ganz unten im Menü. */
  profil?: ReactNode;
  /** Summe der wartenden Dinge (offene Anmeldungen) — als Punkt am Menü-Knopf. */
  offeneAufgaben?: number;
}) {
  const [offen, setOffen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (offen && !dialog.open) dialog.showModal();
    if (!offen && dialog.open) dialog.close();
  }, [offen]);

  return (
    <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-linie bg-leiste/95 px-2 backdrop-blur lg:hidden">
      <button
        type="button"
        onClick={() => setOffen(true)}
        aria-label={offeneAufgaben ? `Menü öffnen, ${offeneAufgaben} offen` : "Menü öffnen"}
        className="relative grid h-11 w-11 place-items-center rounded-lg text-foreground hover:bg-feld"
      >
        <Icon name="menue" className="h-6 w-6" />
        {offeneAufgaben ? (
          <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-leiste bg-credo-blau" aria-hidden="true" />
        ) : null}
      </button>
      <div className="min-w-0 flex-1">{marke}</div>

      <dialog
        ref={ref}
        onClose={() => setOffen(false)}
        onClick={(ereignis) => {
          if (ereignis.target === ref.current) setOffen(false);
        }}
        aria-label="Menü"
        className="blatt fixed inset-y-0 left-0 m-0 flex h-dvh max-h-dvh w-[86vw] max-w-xs flex-col bg-leiste p-0 text-foreground shadow-xl [&:not([open])]:hidden"
      >
        <div className="flex items-center gap-2 px-3 pb-2 pt-3">
          <div className="min-w-0 flex-1">{marke}</div>
          <button
            type="button"
            onClick={() => setOffen(false)}
            aria-label="Menü schließen"
            className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground hover:bg-feld"
          >
            <Icon name="schliessen" className="h-5 w-5" />
          </button>
        </div>
        {suche && <div className="px-3 pb-3">{suche}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <LeistenNavigation gruppen={gruppen} onNavigieren={() => setOffen(false)} />
          {unten && unten.punkte.length > 0 && (
            <div className="mt-4 border-t border-linie pt-3">
              <LeistenNavigation gruppen={[unten]} onNavigieren={() => setOffen(false)} />
            </div>
          )}
        </div>
        {profil && <div className="border-t border-linie px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">{profil}</div>}
      </dialog>
    </div>
  );
}
