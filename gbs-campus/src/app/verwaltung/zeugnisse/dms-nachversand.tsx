"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { Icon } from "@/components/icons";
import { knopf } from "@/components/ui/knopf";
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

  // Gelb als Signal: Archivkopien fehlen im DMS. Aufbau wie ein Hinweis (Symbol,
  // Satz, Knopf rechts), damit die Seite nur eine Form für „hier ist etwas zu tun“ kennt.
  return (
    <div className={zeigeKasten ? "mb-4 rounded-xl bg-credo-gelb/15 px-4 py-3 text-sm" : undefined}>
      {offen > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 gap-3">
            <Icon name="hinweis" className="mt-0.5 h-[18px] w-[18px] shrink-0 text-foreground" />
            <p id="zeugnis-dms-hinweis" className="min-w-0 text-foreground">
              {offen} {offen === 1 ? "Zeugnis ist" : "Zeugnisse sind"} noch nicht im DMS archiviert.
              {!dmsEingerichtet && " Es ist keine DMS-Adresse eingerichtet (DMS_EMAIL) — der Nachversand ist erst danach möglich."}
            </p>
          </div>
          <button
            type="button"
            onClick={nachsenden}
            disabled={laeuft || !dmsEingerichtet}
            aria-describedby="zeugnis-dms-hinweis"
            className={`shrink-0 ${knopf("sekundaer")}`}
          >
            {laeuft ? "Wird gesendet …" : `An das DMS nachsenden (${offen})`}
          </button>
        </div>
      )}

      <MeldungsBox meldung={meldung} className={offen > 0 ? "mt-3" : ""} />
    </div>
  );
}
