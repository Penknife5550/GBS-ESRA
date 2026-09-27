"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

type Ergebnis = { gesendet: number; fehlgeschlagen: number; offen: number };

function zeugnisWort(n: number): string {
  return n === 1 ? "Zeugnis" : "Zeugnisse";
}

/**
 * Zeigt, wie viele gültige Zeugnisse noch nicht im DMS archiviert sind, und
 * sendet ihre Archivkopien gesammelt nach. Die Zahl ermittelt die Seite
 * serverseitig; ohne offene Zeugnisse (und ohne Meldung) erscheint nichts —
 * die Live-Regionen der Meldung stehen aber immer im DOM. Sonst würde nach dem
 * letzten nachgesendeten Zeugnis (offen = 0) die Region erst mit der
 * Erfolgsmeldung eingefügt und von Screenreadern nicht angesagt.
 */
export function DmsNachversand({ offen, dmsEingerichtet }: { offen: number; dmsEingerichtet: boolean }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  async function nachsenden() {
    setLaeuft(true);
    setMeldung(null);

    const antwort = await sendeAnfrage<Ergebnis>("/api/zeugnisse/dms-nachsenden", { methode: "POST" });
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      // Auch im Fehlerfall neu laden: Ein Teil kann trotzdem gesendet sein (oder
      // ein zweiter Lauf hat gesendet) — sonst bliebe die Zahl veraltet stehen.
      router.refresh();
      return;
    }

    const { gesendet, fehlgeschlagen, offen: rest } = antwort.daten;
    if (fehlgeschlagen > 0) {
      setMeldung({
        art: "fehler",
        text:
          `${fehlgeschlagen} ${zeugnisWort(fehlgeschlagen)} ${fehlgeschlagen === 1 ? "konnte" : "konnten"} nicht an das DMS gesendet werden` +
          (gesendet > 0 ? ` (${gesendet} gesendet)` : "") +
          ". Bitte später erneut nachsenden — die genaue Ursache steht im Versandprotokoll unter Verwaltung → Betrieb (Administrator).",
      });
    } else if (gesendet === 0) {
      // Zeitgleich schon nachgesendet (zweiter Tab) — kein Fehler.
      setMeldung({ art: "ok", text: "Es war nichts (mehr) nachzusenden." });
    } else {
      setMeldung({
        art: "ok",
        text:
          `${gesendet} ${zeugnisWort(gesendet)} an das DMS nachgesendet.` +
          (rest > 0 ? ` ${rest} ${rest === 1 ? "weiteres steht" : "weitere stehen"} noch aus — bitte erneut nachsenden.` : ""),
      });
    }
    router.refresh();
  }

  const zeigeKasten = offen > 0 || meldung !== null;

  return (
    <div className={zeigeKasten ? "mt-6 rounded-lg border border-border bg-credo-gelb/15 px-4 py-4 text-sm" : undefined}>
      {offen > 0 && (
        <p id="zeugnis-dms-hinweis">
          {offen} {offen === 1 ? "Zeugnis ist" : "Zeugnisse sind"} noch nicht im DMS archiviert.
          {!dmsEingerichtet && " Es ist keine DMS-Adresse eingerichtet (DMS_EMAIL) — der Nachversand ist erst danach möglich."}
        </p>
      )}

      {offen > 0 && (
        <button
          type="button"
          onClick={nachsenden}
          disabled={laeuft || !dmsEingerichtet}
          aria-describedby="zeugnis-dms-hinweis"
          className="mt-3 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {laeuft ? "Wird gesendet …" : `An das DMS nachsenden (${offen})`}
        </button>
      )}

      <MeldungsBox meldung={meldung} className="mt-3" />
    </div>
  );
}
