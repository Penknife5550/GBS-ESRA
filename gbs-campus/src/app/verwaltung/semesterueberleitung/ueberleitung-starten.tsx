"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

type Ziel = { id: string; bezeichnung: string; zeitraum: string };
type Ergebnis = { eingeladen: number; gesendet: number };

/**
 * Startet die Überleitung des laufenden Jahrgangs ins gewählte Folgesemester.
 * Weil dabei an den ganzen Jahrgang eine Einladungsmail geht, wird der Klick
 * bewusst noch einmal abgefragt.
 */
export function UeberleitungStarten({ ziele, laufend }: { ziele: Ziel[]; laufend: string }) {
  const router = useRouter();
  const [zielId, setZielId] = useState(ziele[0]?.id ?? "");
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: "ok" | "fehler"; text: string } | null>(null);

  if (ziele.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
        Es ist noch kein weiteres Semester angelegt, in das übergeleitet werden könnte. Bitte zuerst
        unter <span className="font-medium">Semester</span> ein Folgesemester anlegen.
      </p>
    );
  }

  const ziel = ziele.find((z) => z.id === zielId);

  async function starten() {
    if (!zielId || !ziel) return;
    if (
      !window.confirm(
        `Überleitung von „${laufend}" nach „${ziel.bezeichnung}" starten?\n\n` +
          "Alle aktiven Teilnehmer des laufenden Semesters bekommen eine Einladungsmail mit ihrem " +
          "persönlichen „Ich bin dabei\"-Link.",
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

    const { eingeladen, gesendet } = antwort.daten;
    setMeldung({
      art: "ok",
      text:
        eingeladen === 0
          ? "Es war niemand neu einzuladen — alle aktiven Teilnehmer haben in diesem Semester bereits eine Teilnahme."
          : `${eingeladen} ${eingeladen === 1 ? "Person wurde" : "Personen wurden"} eingeladen, ` +
            `${gesendet} ${gesendet === 1 ? "Einladung" : "Einladungen"} verschickt.` +
            (gesendet < eingeladen
              ? " Nicht jede Einladung ging raus — bitte im Betrieb die fehlgeschlagenen E-Mails prüfen."
              : ""),
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

      <button
        type="button"
        onClick={starten}
        disabled={laeuft}
        className="mt-4 min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird gestartet …" : "Überleitung starten"}
      </button>

      {meldung && (
        <p
          role={meldung.art === "ok" ? "status" : "alert"}
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${meldung.art === "ok" ? "bg-credo-gruen/10" : "bg-credo-rot/10"}`}
        >
          {meldung.text}
        </p>
      )}
    </div>
  );
}
