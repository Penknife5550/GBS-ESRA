/**
 * GBS Campus — Rückmeldung nach einer Aktion (Meldungsbox)
 *
 * Warum eine eigene Komponente: Vorher stand an fast zwanzig Stellen
 * `{meldung && <p role="status">…</p>}`. Damit entsteht die Live-Region erst
 * zusammen mit ihrem Text — und genau das kündigen Screenreader (NVDA, JAWS,
 * VoiceOver) oft NICHT an: Sie melden nur Änderungen an einer Region, die schon
 * im Dokument stand. Wer blind „Speichern" drückte, hörte nichts.
 *
 * Deshalb stehen hier beide Regionen IMMER im DOM: `role="status"` (höflich) für
 * Erfolg und Warnung, `role="alert"` für Fehler. Leer sind sie `sr-only` —
 * unsichtbar und ohne Platz, auch in Flex- und Grid-Zeilen (absolut
 * positioniert, also kein zusätzlicher Abstand durch `gap`). Mit Text werden sie
 * zur sichtbaren Box; weil es dasselbe Element bleibt, wird der Text angesagt.
 *
 * Kein "use client" nötig: rein darstellend, der Zustand liegt beim Aufrufer.
 */

import type { ReactNode } from "react";

export type Meldung = { art: "ok" | "warnung" | "fehler"; text: string };

const TON: Record<Meldung["art"], string> = {
  ok: "bg-credo-gruen/10",
  warnung: "bg-credo-gelb/15",
  fehler: "bg-credo-rot/10",
};

export function MeldungsBox({
  meldung,
  className = "",
  children,
}: {
  meldung: Meldung | null;
  /** Abstand und Breite der sichtbaren Box, z. B. „mt-3" oder „mt-4 max-w-prose". */
  className?: string;
  /** Zusatz hinter dem Text, etwa ein Link „Akte öffnen". */
  children?: ReactNode;
}) {
  const hoeflich = meldung !== null && meldung.art !== "fehler";
  const dringend = meldung !== null && meldung.art === "fehler";
  const box = (art: Meldung["art"]) => `${className} rounded-lg px-3 py-2 text-sm text-foreground ${TON[art]}`;

  return (
    <>
      <div role="status" className={hoeflich ? box(meldung.art) : "sr-only"}>
        {hoeflich && (
          <>
            {meldung.text}
            {children}
          </>
        )}
      </div>
      <div role="alert" className={dringend ? box("fehler") : "sr-only"}>
        {dringend && (
          <>
            {meldung.text}
            {children}
          </>
        )}
      </div>
    </>
  );
}
