"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

type Ergebnis = { erneutEingeladen: number };

/**
 * „Einladung nicht zugestellt: N" mit dem Knopf „Erneut senden" — je
 * Zielsemester, das noch nicht begonnen hat. Der Server gibt jeder dieser
 * Einladungen einen frischen Link und verschickt sie im Hintergrund.
 *
 * Solange Einladungen rausgehen (`laeuft`), steht statt Zahl und Knopf ein
 * Hinweis: Die Versandzeilen fehlen dann noch, die Zahl wäre falsch, und ein
 * zweiter Versand tauschte die Links der gerade verschickten Mails. Die
 * Komponente bleibt dabei stehen, damit die Meldung nach dem Klick sichtbar
 * bleibt.
 */
export function Nachversand({
  semesterId,
  semester,
  anzahl,
  laeuft,
}: {
  semesterId: string;
  semester: string;
  /** Offene Einladungen dieses Semesters, die nie zugestellt wurden. */
  anzahl: number;
  /** Gehen für dieses Semester gerade Einladungen raus? */
  laeuft: boolean;
}) {
  const router = useRouter();
  const [sendet, setSendet] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  async function erneutSenden() {
    if (
      !window.confirm(
        `Einladung für „${semester}“ erneut senden?\n\n` +
          `${anzahl} ${anzahl === 1 ? "Person bekommt" : "Personen bekommen"} die Einladung noch einmal, mit einem ` +
          "neuen persönlichen Link. Der bisherige Link ist nie angekommen und gilt danach nicht mehr.",
      )
    ) {
      return;
    }

    setSendet(true);
    setMeldung(null);
    const antwort = await sendeAnfrage<Ergebnis>("/api/semesterueberleitung/erneut-senden", {
      methode: "POST",
      rumpf: { semesterId },
    });
    setSendet(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }

    const { erneutEingeladen } = antwort.daten;
    setMeldung({
      art: "ok",
      text:
        erneutEingeladen === 0
          ? "Es war keine Einladung (mehr) erneut zu senden — inzwischen sind alle zugestellt oder beantwortet."
          : `${erneutEingeladen} ${erneutEingeladen === 1 ? "Einladung geht" : "Einladungen gehen"} jetzt erneut raus. ` +
            "Laden Sie die Seite in einer Minute neu, dann sehen Sie, ob sie zugestellt wurden; Einzelheiten stehen unter " +
            "Verwaltung → Betrieb.",
    });
    router.refresh();
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-credo-gelb/15 px-4 py-3 text-sm">
      {laeuft ? (
        <p>
          Die Einladungen für dieses Semester werden gerade verschickt. Laden Sie die Seite in einer Minute neu —
          dann steht hier, ob alle zugestellt wurden.
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-medium">{`Einladung nicht zugestellt: ${anzahl}`}</p>
          <button
            type="button"
            onClick={erneutSenden}
            disabled={sendet}
            className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {sendet ? "Wird gesendet …" : "Erneut senden"}
          </button>
        </div>
      )}
      <MeldungsBox meldung={meldung} className="mt-3" />
    </div>
  );
}
