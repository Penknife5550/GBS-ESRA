"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

type Ziel = {
  id: string;
  bezeichnung: string;
  zeitraum: string;
  /** Alle Erinnerungs-Stichtage sind schon erreicht — es folgt keine Erinnerung mehr. */
  keineErinnerungMehr: boolean;
};
type Ergebnis = { eingeladen: number };

/**
 * Startet die Überleitung des laufenden Jahrgangs ins gewählte Folgesemester.
 * Weil dabei an den ganzen Jahrgang eine Einladungsmail geht, wird der Klick
 * bewusst noch einmal abgefragt. Der Server antwortet sofort mit der Zahl der
 * Eingeladenen; die Mails gehen danach im Hintergrund raus.
 */
export function UeberleitungStarten({ ziele, laufend }: { ziele: Ziel[]; laufend: string }) {
  const router = useRouter();
  const [zielId, setZielId] = useState(ziele[0]?.id ?? "");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  if (ziele.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
        Es gibt kein Folgesemester, das noch nicht begonnen hat. Bitte zuerst unter{" "}
        <span className="font-medium">Semester</span> ein Folgesemester anlegen.
      </p>
    );
  }

  const ziel = ziele.find((z) => z.id === zielId);

  async function starten() {
    if (!zielId || !ziel) return;
    if (
      !window.confirm(
        `Überleitung von „${laufend}" nach „${ziel.bezeichnung}" starten?\n\n` +
          "Alle Teilnehmer des laufenden Semesters bekommen eine Einladungsmail mit ihrem persönlichen " +
          "Link für „Ich bin dabei“ oder „Ich bin raus“. Wer bis zum Semesterstart nicht antwortet, ist " +
          "für das neue Semester abgemeldet.",
      )
    ) {
      return;
    }

    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage<Ergebnis>("/api/semesterueberleitung/start", {
      methode: "POST",
      rumpf: { semesterId: zielId },
    });
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }

    const { eingeladen } = antwort.daten;
    setMeldung({
      art: "ok",
      text:
        eingeladen === 0
          ? "Es war niemand neu einzuladen — alle Teilnehmer des laufenden Semesters haben im Folgesemester bereits eine Teilnahme."
          : `${eingeladen} ${eingeladen === 1 ? "Person wurde" : "Personen wurden"} eingeladen. ` +
            "Die Einladungen gehen jetzt im Hintergrund raus. Nicht zugestellte Einladungen zeigt diese Seite nach " +
            "dem Versand unter „Stand der Rückmeldungen“ — dort lassen sie sich erneut senden.",
    });
    router.refresh();
  }

  return (
    <div>
      <label htmlFor="zielsemester" className="block text-sm font-medium">
        Folgesemester
      </label>
      <select
        id="zielsemester"
        value={zielId}
        onChange={(e) => setZielId(e.target.value)}
        className="mt-1.5 min-h-11 w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
      >
        {ziele.map((z) => (
          <option key={z.id} value={z.id}>
            {z.bezeichnung} ({z.zeitraum})
          </option>
        ))}
      </select>

      {ziel?.keineErinnerungMehr && (
        <p id="ueberleitung-keine-erinnerung" className="mt-3 rounded-lg bg-credo-gelb/15 px-4 py-3 text-sm">
          Für dieses Semester folgt keine Erinnerung mehr — alle Stichtage sind erreicht. Eine nicht zugestellte
          Einladung wird deshalb nicht von selbst wiederholt: Bitte prüfen Sie nach dem Start unten unter „Stand der
          Rückmeldungen“, ob alle Einladungen zugestellt wurden, und senden Sie sie dort bei Bedarf erneut.
        </p>
      )}

      <button
        type="button"
        onClick={starten}
        aria-describedby={ziel?.keineErinnerungMehr ? "ueberleitung-keine-erinnerung" : undefined}
        disabled={laeuft}
        className="mt-4 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird gestartet …" : "Überleitung starten"}
      </button>

      <MeldungsBox meldung={meldung} className="mt-4" />
    </div>
  );
}
