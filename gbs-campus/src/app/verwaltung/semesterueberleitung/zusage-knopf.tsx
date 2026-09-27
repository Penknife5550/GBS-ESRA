"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendeAnfrage } from "@/lib/api-client";
import { knopf } from "@/components/ui/knopf";
import { MeldungsBox, type Meldung } from "@/components/ui/meldung";

/**
 * Trägt eine Zusage ein, die nicht über den Link kam — etwa am Telefon oder im
 * Gespräch. Ohne sie würde die Person zum Semesterstart als „keine Rückmeldung"
 * abgemeldet. Die Rückfrage verhindert, dass ein Fehlklick jemanden als dabei
 * einträgt.
 */
export function ZusageKnopf({ teilnahmeId, name, semester }: { teilnahmeId: string; name: string; semester: string }) {
  const router = useRouter();
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<Meldung | null>(null);

  async function eintragen() {
    if (
      !window.confirm(
        `Zusage für ${name} im „${semester}“ eintragen?\n\n` +
          "Etwa nach einem Anruf. Die Person gilt dann als dabei und wird zum Semesterstart nicht abgemeldet.",
      )
    ) {
      return;
    }

    setLaeuft(true);
    setMeldung(null);
    const antwort = await sendeAnfrage("/api/semesterueberleitung/zusage", {
      methode: "POST",
      rumpf: { teilnahmeId },
    });
    setLaeuft(false);

    if (!antwort.ok) {
      setMeldung({ art: "fehler", text: antwort.meldung });
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={eintragen}
        disabled={laeuft}
        aria-label={`Zusage für ${name} eintragen`}
        className={knopf("sekundaer", "klein")}
      >
        {laeuft ? "Wird eingetragen …" : "Zusage eintragen"}
      </button>
      <MeldungsBox meldung={meldung} className="max-w-xs" />
    </div>
  );
}
