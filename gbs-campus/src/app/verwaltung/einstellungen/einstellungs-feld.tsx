"use client";

import { useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";
import { Icon } from "@/components/icons";
import { Blatt } from "@/components/ui/blatt";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

export type EinstellungsAnzeige = {
  schluessel: string;
  bezeichnung: string;
  beschreibung: string | null;
  wert: string;
  minimum: number | null;
  maximum: number | null;
  einheit: string | null;
};

/**
 * Eine Einstellung als Zeile der Gruppe: Bezeichnung, kurz die Beschreibung und
 * rechts der geltende Wert. Ein Klick öffnet das Blatt zum Ändern
 * (Oberflächenplan 09/2026: erst den Stand zeigen, geändert wird im Blatt).
 * Nach dem Speichern schließt das Blatt, die Zeile zeigt den neuen Wert, und
 * „Gespeichert.“ steht darunter (Live-Region, auch für Vorlesesoftware).
 */
export function EinstellungsFeld({ einstellung }: { einstellung: EinstellungsAnzeige }) {
  const [offen, setOffen] = useState(false);
  const [wert, setWert] = useState(einstellung.wert);
  const [gespeichert, setGespeichert] = useState(einstellung.wert);
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const [rueckmeldung, setRueckmeldung] = useState<Meldung | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const geaendert = wert !== gespeichert;
  const mitEinheit = (zahl: string) => (einstellung.einheit ? `${zahl} ${einstellung.einheit}` : zahl);

  function oeffnen() {
    setWert(gespeichert);
    setMeldung(null);
    setRueckmeldung(null);
    setOffen(true);
  }

  async function speichern() {
    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage("/api/einstellungen", {
      methode: "PUT",
      rumpf: { schluessel: einstellung.schluessel, wert: Number(wert) },
    });
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    setGespeichert(wert);
    setOffen(false);
    setRueckmeldung({ art: "ok", text: "Gespeichert." });
  }

  return (
    <div>
      <button
        type="button"
        onClick={oeffnen}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/60 focus-visible:bg-muted/60"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{einstellung.bezeichnung}</span>
          {einstellung.beschreibung && (
            <span className="hidden truncate text-[13px] text-muted-foreground sm:block">{einstellung.beschreibung}</span>
          )}
        </span>
        <span className="shrink-0 whitespace-nowrap text-sm tabular-nums text-muted-foreground">
          {mitEinheit(gespeichert)}
        </span>
        <Icon name="weiter" className="h-4 w-4 shrink-0 text-dezent" />
      </button>
      <MeldungsBox meldung={rueckmeldung} className="mx-4 mb-3" />

      <Blatt offen={offen} onSchliessen={() => setOffen(false)} titel={einstellung.bezeichnung}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (geaendert && !laeuft) speichern();
          }}
        >
          {einstellung.beschreibung && <p className="text-sm text-muted-foreground">{einstellung.beschreibung}</p>}

          <label htmlFor={einstellung.schluessel} className="mt-4 block text-sm font-medium">
            {einstellung.einheit ? `Wert in ${einstellung.einheit}` : "Wert"}
          </label>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <input
              id={einstellung.schluessel}
              type="number"
              inputMode="numeric"
              value={wert}
              min={einstellung.minimum ?? undefined}
              max={einstellung.maximum ?? undefined}
              onChange={(e) => {
                setWert(e.target.value);
                setMeldung(null);
              }}
              aria-describedby={`${einstellung.schluessel}-grenzen`}
              className="w-28 rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
            />
            {einstellung.minimum !== null && einstellung.maximum !== null && (
              <span id={`${einstellung.schluessel}-grenzen`} className="text-xs text-muted-foreground">
                erlaubt: {einstellung.minimum} – {einstellung.maximum}
              </span>
            )}
          </div>

          <MeldungsBox meldung={meldung} className="mt-3" />

          <p className="mt-4 text-xs text-muted-foreground">Gilt sofort, ohne Neustart. Jede Änderung steht im Protokoll.</p>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setOffen(false)} className={knopf("sekundaer")}>
              Abbrechen
            </button>
            <button type="submit" disabled={!geaendert || laeuft} className={knopf("primaer")}>
              {laeuft ? "Speichert …" : "Speichern"}
            </button>
          </div>
        </form>
      </Blatt>
    </div>
  );
}
