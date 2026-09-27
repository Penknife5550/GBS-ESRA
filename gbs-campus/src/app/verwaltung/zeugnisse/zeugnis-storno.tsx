"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { STORNO_GRUND_MAX_LAENGE } from "@/lib/zeugnis";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

type Antwort = { zeugnisId: string; belegNr: string; status: string; storniertAm: string };

const nebenKlasse =
  "min-h-11 inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-sm hover:border-primary disabled:opacity-60";
const knopfKlasse =
  "min-h-11 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60";

/**
 * „Stornieren“ an einem gültigen Zeugnis (Zeugnisseite und Detailakte, Recht
 * NOTEN_VERWALTEN): Der Knopf öffnet ein Pflichtfeld für den Grund, danach kommt
 * die Rückfrage (Text vom Aufrufer, `stornoRueckfrage`), dann
 * POST /api/zeugnisse/[id]/stornieren. Der Grund bleibt intern — er erscheint
 * weder auf dem Zeugnis noch im Protokoll.
 *
 * Die Erfolgsmeldung geht an `onErledigt`, wenn der Aufrufer eine eigene, stehen
 * bleibende Meldung führt (Zeugnisseite: die Zeile wechselt beim Neuladen). Ohne
 * `onErledigt` zeigt die Komponente sie selbst — dafür rendert die Detailakte sie
 * für jede Zeile mit stabilem `key` und `stornierbar` als Schalter: So bleibt sie
 * nach dem Neuladen stehen, und die Meldung mit ihr.
 */
export function ZeugnisStorno({
  zeugnisId,
  stornierbar,
  rueckfrage,
  beschriftung,
  onErledigt,
}: {
  zeugnisId: string;
  /** Nur ein gültiges Zeugnis einer nicht anonymisierten Person lässt sich
   * stornieren — sonst steht hier nur die Meldung. */
  stornierbar: boolean;
  rueckfrage: string;
  /** Vorgelesene Beschriftung des Knopfs, z. B. „Zeugnis von Muster, Max stornieren“. */
  beschriftung: string;
  onErledigt?: (text: string) => void;
}) {
  const router = useRouter();
  const feldId = useId();
  const [offen, setOffen] = useState(false);
  const [grund, setGrund] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  // Fokus folgt dem Wechsel zwischen Knopf und Formular — sonst fiele er beim
  // Öffnen und beim Abbrechen auf die Seite zurück.
  const feldRef = useRef<HTMLTextAreaElement>(null);
  const knopfRef = useRef<HTMLButtonElement>(null);
  const [fokusZumKnopf, setFokusZumKnopf] = useState(false);
  useEffect(() => {
    if (offen) feldRef.current?.focus();
    else if (fokusZumKnopf) {
      knopfRef.current?.focus();
      setFokusZumKnopf(false);
    }
  }, [offen, fokusZumKnopf]);

  async function stornieren() {
    // Folgenreich: Das Dokument wird für die Person sofort unzugänglich.
    if (!window.confirm(rueckfrage)) return;
    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage<Antwort>(`/api/zeugnisse/${zeugnisId}/stornieren`, {
      methode: "POST",
      rumpf: { grund },
    });
    setLaeuft(false);
    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    const text = `Beleg ${antwort.daten.belegNr} ist storniert und damit ungültig. Er bleibt als Nachweis gespeichert.`;
    setOffen(false);
    setGrund("");
    if (onErledigt) onErledigt(text);
    else setMeldung({ art: "ok", text });
    router.refresh();
  }

  return (
    <>
      {stornierbar && !offen && (
        <button
          ref={knopfRef}
          type="button"
          onClick={() => {
            setOffen(true);
            setMeldung(null);
          }}
          aria-label={beschriftung}
          className={nebenKlasse}
        >
          Stornieren
        </button>
      )}
      {stornierbar && offen && (
        <div className="w-full rounded-lg border border-border bg-muted p-3 sm:max-w-md">
          <label htmlFor={feldId} className="block text-sm font-medium">
            Grund des Stornos (Pflicht, nur intern)
          </label>
          <textarea
            ref={feldRef}
            id={feldId}
            rows={2}
            maxLength={STORNO_GRUND_MAX_LAENGE}
            value={grund}
            onChange={(e) => setGrund(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={stornieren}
              disabled={laeuft || grund.trim().length === 0}
              className={knopfKlasse}
            >
              {laeuft ? "Wird storniert …" : "Jetzt stornieren"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOffen(false);
                setFokusZumKnopf(true);
              }}
              disabled={laeuft}
              className={nebenKlasse}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
      <MeldungsBox meldung={meldung} className="w-full" />
    </>
  );
}
