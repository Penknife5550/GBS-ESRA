"use client";

/**
 * GBS Campus — Blatt
 *
 * Bearbeiten öffnet sich über der Seite, statt dass Formulare dauerhaft offen
 * stehen (Oberflächenplan 09/2026): am Handy als Blatt von unten, am Rechner als
 * Fenster in der Mitte. Gebaut auf dem nativen `<dialog>` — der Browser
 * übernimmt Fokusfalle, Escape und das Sperren der Seite dahinter.
 *
 * `Blatt` ist gesteuert (offen/onSchliessen); `BlattKnopf` bringt den Auslöser
 * und den Zustand gleich mit. `children` darf eine Funktion sein, die
 * `schliessen` bekommt — so kann ein Formular das Blatt nach dem Speichern
 * selbst zumachen.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { knopf, type KnopfArt, type KnopfGroesse } from "./knopf";

export function Blatt({
  offen,
  onSchliessen,
  titel,
  children,
  fuss,
  breit = false,
}: {
  offen: boolean;
  onSchliessen: () => void;
  titel: ReactNode;
  children: ReactNode;
  /** Knopfleiste unten, etwa „Abbrechen“ und „Sichern“. */
  fuss?: ReactNode;
  /** Mehr Platz am Rechner, etwa für Tabellen. */
  breit?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titelId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (offen && !dialog.open) dialog.showModal();
    if (!offen && dialog.open) dialog.close();
  }, [offen]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titelId}
      onClose={onSchliessen}
      onClick={(ereignis) => {
        // Klick auf den abgedunkelten Rand (das Dialog-Element selbst) schließt.
        if (ereignis.target === ref.current) onSchliessen();
      }}
      className={`blatt fixed inset-x-0 bottom-0 m-0 mt-auto flex max-h-[92dvh] w-full max-w-none flex-col rounded-t-2xl bg-background p-0 text-foreground shadow-xl sm:inset-0 sm:m-auto sm:h-fit sm:rounded-2xl ${
        breit ? "sm:max-w-3xl" : "sm:max-w-lg"
      } [&:not([open])]:hidden`}
    >
      <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-input sm:hidden" aria-hidden="true" />
      <div className="flex items-center gap-3 border-b border-linie px-5 py-3.5">
        <h2 id={titelId} className="text-base font-semibold">
          {titel}
        </h2>
        <button
          type="button"
          onClick={onSchliessen}
          aria-label="Schließen"
          className="-mr-2 ml-auto grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-muted lg:h-9 lg:w-9"
        >
          <Icon name="schliessen" className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {fuss && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-linie px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {fuss}
        </div>
      )}
    </dialog>
  );
}

export function BlattKnopf({
  text,
  titel,
  children,
  art = "sekundaer",
  groesse = "normal",
  icon,
  breit,
  knopfKlasse,
}: {
  text: ReactNode;
  titel: ReactNode;
  children: ReactNode | ((schliessen: () => void) => ReactNode);
  art?: KnopfArt;
  groesse?: KnopfGroesse;
  icon?: IconName;
  breit?: boolean;
  knopfKlasse?: string;
}) {
  const [offen, setOffen] = useState(false);
  const schliessen = () => setOffen(false);
  return (
    <>
      <button type="button" onClick={() => setOffen(true)} className={knopfKlasse ?? knopf(art, groesse)}>
        {icon && <Icon name={icon} className="h-4 w-4" />}
        {text}
      </button>
      <Blatt offen={offen} onSchliessen={schliessen} titel={titel} breit={breit}>
        {typeof children === "function" ? children(schliessen) : children}
      </Blatt>
    </>
  );
}
