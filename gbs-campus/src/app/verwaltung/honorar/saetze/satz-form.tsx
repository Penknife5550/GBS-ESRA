"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

type Antwort = { belegNr: string; dmsGesendet: boolean };

/**
 * Formular zum Genehmigen eines neuen Honorarsatzes. Das Absenden IST die
 * Genehmigung; nach Erfolg geht ein Beleg an das DMS (Rückmeldung mit Beleg-Nr).
 */
export function SatzForm() {
  const router = useRouter();
  const [betrag, setBetrag] = useState("");
  const [gueltigAb, setGueltigAb] = useState("");
  const [notiz, setNotiz] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);

  async function genehmigen() {
    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage<Antwort>("/api/honorar/saetze", {
      methode: "POST",
      rumpf: {
        betrag: Number(betrag),
        gueltigAb,
        notiz: notiz.trim() ? notiz.trim() : undefined,
      },
    });
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }

    const dms = antwort.daten.dmsGesendet
      ? `Beleg ${antwort.daten.belegNr} an das DMS gesendet.`
      : `Beleg ${antwort.daten.belegNr} erzeugt — DMS-Versand steht aus (E-Mail noch nicht eingerichtet).`;
    setMeldung({ art: "ok", text: `Satz genehmigt. ${dms}` });
    setBetrag("");
    setGueltigAb("");
    setNotiz("");
    router.refresh();
  }

  const bereit = betrag.trim() !== "" && gueltigAb.trim() !== "";

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="text-sm font-medium">Neuen Satz genehmigen</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Der Satz gilt ab dem gewählten Tag; Abende davor behalten ihren bisherigen Satz. Das Genehmigen
        erzeugt einen Beleg mit der kompletten Historie und übergibt ihn an das Dokumentenmanagement.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="betrag" className="block text-sm font-medium">
            Satz je Unterrichtsabend
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              id="betrag"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={betrag}
              onChange={(e) => {
                setBetrag(e.target.value);
                setMeldung(null);
              }}
              className="w-32 rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
            />
            <span className="text-sm text-muted-foreground">€</span>
          </div>
        </div>

        <div>
          <label htmlFor="gueltigAb" className="block text-sm font-medium">
            Gültig ab
          </label>
          <input
            id="gueltigAb"
            type="date"
            value={gueltigAb}
            onChange={(e) => {
              setGueltigAb(e.target.value);
              setMeldung(null);
            }}
            className="mt-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
          />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="notiz" className="block text-sm font-medium">
          Vermerk <span className="font-normal text-muted-foreground">(optional, z. B. Beschlussdatum)</span>
        </label>
        <input
          id="notiz"
          type="text"
          maxLength={500}
          value={notiz}
          onChange={(e) => setNotiz(e.target.value)}
          className="mt-1 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
        />
      </div>

      <button
        type="button"
        onClick={genehmigen}
        disabled={!bereit || laeuft}
        className="mt-4 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Genehmigt …" : "Satz genehmigen"}
      </button>

      {meldung && (
        <p
          role={meldung.art === "ok" ? "status" : "alert"}
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            meldung.art === "ok" ? "bg-credo-gruen/10 text-foreground" : "bg-credo-rot/10 text-foreground"
          }`}
        >
          {meldung.text}
        </p>
      )}
    </div>
  );
}
