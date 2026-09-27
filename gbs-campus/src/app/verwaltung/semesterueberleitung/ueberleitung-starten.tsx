"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import type { ZeitleistenPunkt } from "@/lib/semesterplan";
import { Hinweis } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";
import { Zeitleiste } from "../semester/zeitleiste";

type Ziel = {
  id: string;
  bezeichnung: string;
  zeitraum: string;
  /** Alle Erinnerungs-Stichtage sind schon erreicht — es folgt keine Erinnerung mehr. */
  keineErinnerungMehr: boolean;
  /** So viele aus dem laufenden Semester würden jetzt eingeladen. */
  einzuladen: number;
  /** Einladung, Erinnerungen und Beginn mit den echten Daten. */
  zeitleiste: ZeitleistenPunkt[];
};
type Ergebnis = { eingeladen: number };

/**
 * Startet die Überleitung des laufenden Jahrgangs ins gewählte Folgesemester.
 * Die Zeitleiste zeigt vorher, wann was passiert. Weil dabei an den ganzen
 * Jahrgang eine Einladungsmail geht, wird der Klick bewusst noch einmal mit der
 * Zahl der Empfänger abgefragt. Der Server antwortet sofort mit der Zahl der
 * Eingeladenen; die Mails gehen danach im Hintergrund raus.
 */
export function UeberleitungStarten({ ziele, laufend }: { ziele: Ziel[]; laufend: string }) {
  const router = useRouter();
  const [zielId, setZielId] = useState(ziele[0]?.id ?? "");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  if (ziele.length === 0) {
    return (
      <Hinweis
        titel="Es gibt kein Folgesemester, das noch nicht begonnen hat."
        aktion={
          <Link href="/verwaltung/semester" className={knopf("sekundaer")}>
            Zu den Semestern
          </Link>
        }
      >
        Bitte zuerst unter „Semester“ ein Folgesemester anlegen.
      </Hinweis>
    );
  }

  const ziel = ziele.find((z) => z.id === zielId) ?? ziele[0];

  async function starten() {
    if (!ziel) return;
    const empfaenger =
      ziel.einzuladen === 1
        ? "1 Teilnehmer des laufenden Semesters bekommt"
        : `${ziel.einzuladen} Teilnehmer des laufenden Semesters bekommen`;
    if (
      !window.confirm(
        `Überleitung von „${laufend}" nach „${ziel.bezeichnung}" starten?\n\n` +
          `${empfaenger} eine Einladungsmail mit einem persönlichen ` +
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
      rumpf: { semesterId: ziel.id },
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
    <section aria-labelledby="ueberleitung-titel" className="rounded-xl border border-linie bg-card px-5 py-4">
      <h2 id="ueberleitung-titel" className="text-[15px] font-semibold text-foreground">
        {`Einladung ins ${ziel.bezeichnung}`}
      </h2>
      <p className="text-[13px] text-muted-foreground">
        {ziel.einzuladen > 0
          ? `Alle ${ziel.einzuladen} aus dem ${laufend} bekommen eine Mail mit „Ich bin dabei“ oder „Ich bin raus“.`
          : `Aus dem ${laufend} ist niemand mehr einzuladen — alle haben dort schon eine Teilnahme.`}
      </p>

      {ziele.length > 1 && (
        <div className="mt-4 max-w-md">
          <label htmlFor="zielsemester" className="block text-sm font-medium">
            Folgesemester
          </label>
          <select
            id="zielsemester"
            value={ziel.id}
            onChange={(e) => setZielId(e.target.value)}
            className="mt-1.5 h-11 w-full rounded-lg border border-input bg-background px-4 text-sm lg:h-10"
          >
            {ziele.map((z) => (
              <option key={z.id} value={z.id}>
                {z.bezeichnung} ({z.zeitraum})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="my-5">
        <Zeitleiste punkte={ziel.zeitleiste} />
      </div>

      {ziel?.keineErinnerungMehr && (
        <p id="ueberleitung-keine-erinnerung" className="mb-4 rounded-xl bg-credo-gelb/15 px-4 py-3 text-sm">
          Für dieses Semester folgt keine Erinnerung mehr — alle Stichtage sind erreicht. Eine nicht zugestellte
          Einladung wird deshalb nicht von selbst wiederholt: Bitte prüfen Sie nach dem Start unten unter „Stand der
          Rückmeldungen“, ob alle Einladungen zugestellt wurden, und senden Sie sie dort bei Bedarf erneut.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <button
          type="button"
          onClick={starten}
          aria-describedby={ziel?.keineErinnerungMehr ? "ueberleitung-keine-erinnerung" : undefined}
          disabled={laeuft}
          className={`shrink-0 ${knopf(ziel.einzuladen > 0 ? "primaer" : "sekundaer")}`}
        >
          {laeuft ? "Wird gestartet …" : "Überleitung starten …"}
        </button>
        <p className="text-[13px] text-muted-foreground">
          Vor dem Versand kommt eine Rückfrage mit der Zahl der Empfänger. Ein zweiter Start lädt niemanden doppelt ein.
        </p>
      </div>

      <MeldungsBox meldung={meldung} className="mt-4" />
    </section>
  );
}
