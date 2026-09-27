"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { euro, HONORAR_SATZ_MIN, HONORAR_SATZ_MAX } from "@/lib/honorar";
import { dmsVersandText, type DmsVersand } from "@/lib/honorar-korrektur";
import { Icon } from "@/components/icons";
import { Blatt } from "@/components/ui/blatt";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

type Antwort = { belegNr: string; dmsGesendet: boolean; dmsVersand: DmsVersand };

/** „JJJJ-MM-TT" aus dem Datumsfeld als „TT.MM.JJJJ" (reiner Kalendertag, ohne Zeitzone). */
function tagDeutsch(iso: string): string {
  const [jahr, monat, tag] = iso.split("-");
  return `${tag}.${monat}.${jahr}`;
}

/**
 * Der Knopf „Neuer Satz“ oben rechts und das Blatt mit dem Formular
 * (Oberflächenplan 09/2026: Anlegen im Blatt statt dauerhaft offener Formulare).
 * Das Formular entsteht bei jedem Öffnen neu — eine Rückmeldung vom letzten Mal
 * steht dann nicht mehr darin.
 */
export function NeuerSatz() {
  const [offen, setOffen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOffen(true)} className={knopf("primaer")}>
        <Icon name="plus" className="h-4 w-4" />
        Neuer Satz
      </button>
      <Blatt offen={offen} onSchliessen={() => setOffen(false)} titel="Neuen Satz genehmigen">
        {offen && <SatzForm onFertig={() => setOffen(false)} />}
      </Blatt>
    </>
  );
}

/**
 * Formular zum Genehmigen eines neuen Honorarsatzes. Das Absenden IST die
 * Genehmigung; nach Erfolg geht ein Beleg an das DMS (Rückmeldung mit Beleg-Nr).
 * Deshalb mit Rückfrage, die Betrag und Gültig-ab nennt: Die Genehmigung ist
 * lohnwirksam, der Beleg geht sofort raus, und zurücknehmen lässt sie sich nur
 * über eine neue Genehmigung. Die Rückmeldung bleibt im Blatt stehen, bis
 * „Fertig“ es schließt — sie nennt, ob der Beleg angekommen ist.
 */
export function SatzForm({ onFertig }: { onFertig: () => void }) {
  const router = useRouter();
  const [betrag, setBetrag] = useState("");
  const [gueltigAb, setGueltigAb] = useState("");
  const [notiz, setNotiz] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  async function genehmigen() {
    if (
      !confirm(
        `${euro(Number(betrag))} je Unterrichtsabend ab ${tagDeutsch(gueltigAb)} genehmigen? Der Beleg geht sofort ` +
          `an das DMS; ändern lässt sich der Satz danach nur über eine neue Genehmigung.`,
      )
    ) {
      return;
    }
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

    // Der tatsächliche Ausgang statt einer pauschal vermuteten Ursache (M12):
    // Nicht angekommen ist ein Hinweis (die Genehmigung gilt), mit Weg zum Nachsenden.
    const { belegNr, dmsVersand } = antwort.daten;
    setMeldung({
      art: dmsVersand === "GESENDET" ? "ok" : "warnung",
      text: `Satz genehmigt. ${dmsVersandText(belegNr, dmsVersand)}`,
    });
    setBetrag("");
    setGueltigAb("");
    setNotiz("");
    router.refresh();
  }

  const bereit = betrag.trim() !== "" && gueltigAb.trim() !== "";
  const erledigt = meldung !== null && meldung.art !== "fehler";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (bereit && !laeuft) genehmigen();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Der Satz gilt ab dem gewählten Tag; Abende davor behalten ihren bisherigen Satz. Das Genehmigen erzeugt einen
        Beleg mit der kompletten Historie und übergibt ihn an das Dokumentenmanagement.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="betrag" className="block text-sm font-medium">
            Satz je Unterrichtsabend
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="betrag"
              type="number"
              inputMode="numeric"
              required
              min={HONORAR_SATZ_MIN}
              max={HONORAR_SATZ_MAX}
              step={1}
              value={betrag}
              onChange={(e) => {
                setBetrag(e.target.value);
                setMeldung(null);
              }}
              aria-describedby="betrag-grenzen"
              className="w-32 rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
            />
            <span className="text-sm text-muted-foreground">€</span>
          </div>
          <span id="betrag-grenzen" className="mt-1 block text-xs text-muted-foreground">
            erlaubt: {HONORAR_SATZ_MIN} – {HONORAR_SATZ_MAX} €
          </span>
        </div>

        <div>
          <label htmlFor="gueltigAb" className="block text-sm font-medium">
            Gültig ab
          </label>
          <input
            id="gueltigAb"
            type="date"
            required
            value={gueltigAb}
            onChange={(e) => {
              setGueltigAb(e.target.value);
              setMeldung(null);
            }}
            className="mt-1.5 rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
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
          onChange={(e) => {
            setNotiz(e.target.value);
            setMeldung(null);
          }}
          className="mt-1.5 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
        />
      </div>

      <MeldungsBox meldung={meldung} className="mt-4" />

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onFertig} className={knopf("sekundaer")}>
          {erledigt ? "Fertig" : "Abbrechen"}
        </button>
        <button type="submit" disabled={!bereit || laeuft} className={knopf("primaer")}>
          {laeuft ? "Wird genehmigt …" : "Satz genehmigen"}
        </button>
      </div>
    </form>
  );
}
