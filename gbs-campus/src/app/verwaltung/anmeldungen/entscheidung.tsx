"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

export function Entscheidung({ anmeldungId, name }: { anmeldungId: string; name: string }) {
  const router = useRouter();
  const [modus, setModus] = useState<"bereit" | "ablehnen">("bereit");
  const [grund, setGrund] = useState("");
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  // Ein Hinweis, der nach der Entscheidung stehen bleiben muss. Vorher stand er
  // in `alert()` — ein Fenster, das mit einem Klick verschwindet und danach
  // nirgends mehr nachlesbar ist.
  const [hinweis, setHinweis] = useState<string | null>(null);

  async function entscheiden(entscheidung: "ANNEHMEN" | "ABLEHNEN") {
    if (entscheidung === "ANNEHMEN" && !confirm(`${name} aufnehmen? Die Aufnahmebestätigung geht sofort per E-Mail raus.`)) {
      return;
    }
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage<{
      entschieden: boolean;
      mailGesendet: boolean | null;
      semesterZugeordnet: boolean | null;
    }>(
      `/api/anmeldungen/${anmeldungId}/entscheiden`,
      { methode: "POST", rumpf: entscheidung === "ANNEHMEN" ? { entscheidung } : { entscheidung, grund } },
    );

    if (!antwort.ok) {
      setLaeuft(false);
      setFehler(antwort.meldung);
      return;
    }

    const hinweise: string[] = [];

    // Der Schulleiter erfaehrt, wenn die Bestaetigung nicht rausging — sonst
    // haelt er jemanden fuer informiert, bei dem nie etwas ankam.
    if (antwort.daten.mailGesendet === false) {
      hinweise.push(
        `${name} wurde aufgenommen. Die Bestätigungsmail konnte aber nicht zugestellt werden — ` +
          "bitte persönlich Bescheid geben. Einzelheiten unter Verwaltung → Betrieb.",
      );
    }

    // Ohne Semester oder ohne Teilnahmeform entsteht keine Teilnahme — die
    // Person stünde dann auf keiner Liste. Das darf nicht stillschweigend
    // passieren.
    if (antwort.daten.semesterZugeordnet === false) {
      hinweise.push(
        `${name} konnte keinem Semester zugeordnet werden. ` +
          "Entweder ist kein Semester als laufend gesetzt oder es fehlt die Teilnahmeform. " +
          "Unter Verwaltung → Aktive dieses Semester lässt sich das nachholen.",
      );
    }

    // Mit dem Neuladen verschwindet diese Karte aus der Arbeitsliste — und mit
    // ihr der Hinweis. Deshalb erst lesen lassen, dann neu laden.
    if (hinweise.length > 0) {
      setLaeuft(false);
      setHinweis(hinweise.join(" "));
      return;
    }

    // Ladezustand bleibt gesetzt, bis die Seite neu geladen hat. Vorher waren
    // die Knoepfe waehrend des Nachladens wieder aktiv und die Karte zeigte den
    // alten Stand — ein zweiter Klick loeste eine zweite Mail aus.
    router.refresh();
  }

  if (hinweis) {
    return (
      <div className="mt-4">
        <p role="status" className="rounded-lg bg-credo-gelb/15 px-3 py-2 text-sm">
          {hinweis}
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-3 min-h-11 rounded-lg border border-input px-4 py-2 text-sm font-medium"
        >
          Gelesen — Liste aktualisieren
        </button>
      </div>
    );
  }

  if (modus === "ablehnen") {
    return (
      <div className="mt-4 rounded-lg border border-border bg-muted p-4">
        <label htmlFor={`grund-${anmeldungId}`} className="mb-1.5 block text-sm font-medium">
          Grund der Ablehnung — nur intern, es geht keine automatische Mail raus
        </label>
        <textarea
          id={`grund-${anmeldungId}`}
          rows={3}
          value={grund}
          onChange={(e) => setGrund(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => entscheiden("ABLEHNEN")}
            disabled={laeuft || grund.trim().length === 0}
            className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {laeuft ? "Wird festgehalten …" : "Ablehnung festhalten"}
          </button>
          <button
            type="button"
            onClick={() => setModus("bereit")}
            className="min-h-11 rounded-lg border border-input px-4 py-2 text-sm font-medium"
          >
            Abbrechen
          </button>
        </div>
        {fehler && (
          <p role="alert" className="mt-2 rounded-lg bg-credo-rot/10 px-3 py-2 text-sm">
            {fehler}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => entscheiden("ANNEHMEN")}
        disabled={laeuft}
        className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {laeuft ? "Wird aufgenommen …" : "Aufnehmen"}
      </button>
      <button
        type="button"
        onClick={() => setModus("ablehnen")}
        disabled={laeuft}
        className="min-h-11 rounded-lg border border-input px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        Ablehnen
      </button>
      {fehler && (
        <p role="alert" className="w-full rounded-lg bg-credo-rot/10 px-3 py-2 text-sm">
          {fehler}
        </p>
      )}
    </div>
  );
}
