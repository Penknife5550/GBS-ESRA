"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { Blatt } from "@/components/ui/blatt";
import { knopf } from "@/components/ui/knopf";

/**
 * Markiert eine freigegebene Abrechnung als ausgezahlt (mit Datum). Der Knopf
 * steht als Hauptaktion oben rechts; das Datum wählt man im Blatt
 * (Oberflächenplan 09/2026), die Rückfrage vor dem Speichern bleibt.
 */
export function AuszahlenForm({ abrechnungId, heute }: { abrechnungId: string; heute: string }) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
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
    setOffen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOffen(true)} className={knopf("primaer")}>
        Als ausgezahlt markieren …
      </button>
      <Blatt offen={offen} onSchliessen={() => setOffen(false)} titel="Auszahlung festhalten">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (datum && !laeuft) auszahlen();
          }}
        >
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
            className="mt-1.5 rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
          />
          {fehler && (
            <span role="alert" className="mt-2 block text-xs text-credo-rot">
              {fehler}
            </span>
          )}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setOffen(false)} className={knopf("sekundaer")}>
              Abbrechen
            </button>
            <button type="submit" disabled={!datum || laeuft} className={knopf("primaer")}>
              {laeuft ? "Speichere …" : "Als ausgezahlt markieren"}
            </button>
          </div>
        </form>
      </Blatt>
    </>
  );
}
