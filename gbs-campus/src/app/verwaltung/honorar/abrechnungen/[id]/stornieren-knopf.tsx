"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";

/**
 * Storniert eine OFFENE Abrechnung (M11): Die Abrechnung wird gelöscht, ihre
 * Abende sind wieder offen und lassen sich — etwa nach einer Korrektur der
 * Dozentenzuordnung im Stundenplan — neu abrechnen. Mit Rückfrage (Hausregel vor
 * destruktiven Aktionen); danach zurück zur Übersicht des Semesters, weil es die
 * Detailseite nicht mehr gibt.
 */
export function StornierenKnopf({
  abrechnungId,
  semesterId,
  abende,
  betrag,
}: {
  abrechnungId: string;
  semesterId: string;
  abende: number;
  betrag: string;
}) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  async function stornieren() {
    if (
      !confirm(
        `Abrechnung stornieren (${abende === 1 ? "1 Abend" : `${abende} Abende`}, ${betrag})? Die Abrechnung wird ` +
          `gelöscht, ihre Abende sind danach wieder offen und lassen sich neu abrechnen — z. B. nach einer ` +
          `Korrektur der Dozentenzuordnung im Stundenplan. Der Vorgang steht im Protokoll.`,
      )
    ) {
      return;
    }
    setLaeuft(true);
    setFehler(null);

    const antwort = await sendeAnfrage(`/api/honorar/abrechnungen/${abrechnungId}`, { methode: "DELETE" });

    if (!antwort.ok) {
      setLaeuft(false);
      setFehler(antwort.meldung);
      return;
    }
    router.push(`/verwaltung/honorar/abrechnungen?semester=${semesterId}`);
  }

  return (
    <div>
      <button
        type="button"
        onClick={stornieren}
        disabled={laeuft}
        className="min-h-11 rounded-lg border border-credo-rot/40 px-4 py-2 text-sm font-medium text-credo-rot hover:bg-credo-rot/5 disabled:opacity-60"
      >
        {laeuft ? "Storniere …" : "Abrechnung stornieren"}
      </button>
      {fehler && (
        <p role="alert" className="mt-3 rounded-lg bg-credo-rot/10 px-3 py-2 text-sm text-foreground">
          {fehler}
        </p>
      )}
    </div>
  );
}
