"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

/** Markiert eine freigegebene Abrechnung als ausgezahlt (mit Datum). */
export function AuszahlenForm({ abrechnungId, heute }: { abrechnungId: string; heute: string }) {
  const router = useRouter();
  const [datum, setDatum] = useState(heute);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function auszahlen() {
    if (!confirm("Abrechnung als ausgezahlt markieren? Der Status wird damit abschließend gesetzt.")) return;
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage(`/api/honorar/abrechnungen/${abrechnungId}/auszahlen`, {
      methode: "POST",
      rumpf: { ausgezahltAm: datum },
    });
    setLaeuft(false);

    if (!antwort.ok) {
      setFehler(antwort.meldung);
      return;
    }
    router.refresh();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (datum && !laeuft) auszahlen();
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <div>
        <label htmlFor="ausgezahltAm" className="block text-sm font-medium">
          Ausgezahlt am
        </label>
        <input
          id="ausgezahltAm"
          type="date"
          required
          value={datum}
          onChange={(e) => {
            setDatum(e.target.value);
            setFehler(null);
          }}
          className="mt-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={!datum || laeuft}
        className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Speichere …" : "Als ausgezahlt markieren"}
      </button>
      {fehler && (
        <span role="alert" className="w-full text-xs text-credo-rot">
          {fehler}
        </span>
      )}
    </form>
  );
}
