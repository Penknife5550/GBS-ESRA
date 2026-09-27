"use client";

import { useState } from "react";
import { sendeAnfrage } from "@/lib/api-client";
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

export function EinstellungsFeld({ einstellung }: { einstellung: EinstellungsAnzeige }) {
  const [wert, setWert] = useState(einstellung.wert);
  const [gespeichert, setGespeichert] = useState(einstellung.wert);
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const geaendert = wert !== gespeichert;

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
    setMeldung({ art: "ok", text: "Gespeichert." });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <label htmlFor={einstellung.schluessel} className="block text-sm font-medium">
        {einstellung.bezeichnung}
      </label>
      {einstellung.beschreibung && (
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{einstellung.beschreibung}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
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
        {einstellung.einheit && <span className="text-sm text-muted-foreground">{einstellung.einheit}</span>}

        {einstellung.minimum !== null && einstellung.maximum !== null && (
          <span id={`${einstellung.schluessel}-grenzen`} className="text-xs text-muted-foreground">
            erlaubt: {einstellung.minimum} – {einstellung.maximum}
          </span>
        )}

        <button
          type="button"
          onClick={speichern}
          disabled={!geaendert || laeuft}
          className="ml-auto min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {laeuft ? "Speichert …" : "Speichern"}
        </button>
      </div>

      <MeldungsBox meldung={meldung} className="mt-3" />
    </div>
  );
}
