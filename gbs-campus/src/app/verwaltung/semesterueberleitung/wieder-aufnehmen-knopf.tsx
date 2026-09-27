"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { knopf } from "@/components/ui/knopf";

/**
 * Nimmt eine abgemeldete Teilnahme wieder auf. Die Person steht danach wieder
 * in allen Listen des Semesters (Anwesenheit, Noten, Export, Zeugnislauf) —
 * deshalb fragt der Knopf vorher nach.
 */
export function WiederAufnehmenKnopf({
  teilnahmeId,
  name,
  semester,
}: {
  teilnahmeId: string;
  name: string;
  semester: string;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function wiederAufnehmen() {
    if (
      !window.confirm(
        `${name} für „${semester}" wieder aufnehmen?\n\n` +
          "Die Teilnahme gilt dann als bestätigt, und die Person steht wieder in allen Listen dieses " +
          "Semesters (Anwesenheit, Noten, Excel-Liste, Zeugnisse).",
      )
    ) {
      return;
    }

    setLaeuft(true);
    setFehler(null);
    const antwort = await sendeAnfrage("/api/semesterueberleitung/wieder-aufnehmen", {
      methode: "POST",
      rumpf: { teilnahmeId },
    });
    setLaeuft(false);

    if (!antwort.ok) {
      setFehler(antwort.meldung);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={wiederAufnehmen}
        disabled={laeuft}
        aria-label={`${name} wieder aufnehmen`}
        className={knopf("sekundaer", "klein")}
      >
        {laeuft ? "Wird aufgenommen …" : "Wieder aufnehmen"}
      </button>
      {fehler && (
        <p role="alert" className="max-w-xs rounded-lg bg-credo-rot/10 px-3 py-2 text-xs">
          {fehler}
        </p>
      )}
    </div>
  );
}
