"use client";

/**
 * GBS Campus — Profil unten in der Leiste
 *
 * Name, Rolle und dahinter „Meine Daten“ und „Abmelden“ — statt eines
 * Abmelde-Knopfs oben auf jeder Seite. Abgemeldet wird wie bisher erst, wenn der
 * Server es bestätigt hat (siehe `abmelden-knopf.tsx`); scheitert es, steht die
 * Meldung unter dem Namen.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { Menue } from "@/components/ui/menue";
import { sendeAnfrage } from "@/lib/api-client";
import { EIGENE_DATEN_PFAD } from "@/lib/navigation";

export function ProfilMenue({ name, initialen, rolle }: { name: string; initialen: string; rolle: string }) {
  const router = useRouter();
  const [fehler, setFehler] = useState<string | null>(null);

  async function abmelden() {
    setFehler(null);
    const antwort = await sendeAnfrage("/api/auth/abmelden", { methode: "POST" });
    if (!antwort.ok) {
      setFehler("Abmelden hat nicht geklappt — Sie sind auf diesem Gerät noch angemeldet. Bitte noch einmal versuchen.");
      return;
    }
    router.push("/anmelden");
    router.refresh();
  }

  return (
    <div>
      <Menue
        label="Profil"
        ausrichtung="oben"
        ausloeserKlasse="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-feld/70"
        ausloeser={
          <>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {initialen}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">{name}</span>
              <span className="block truncate text-[11.5px] text-muted-foreground">{rolle}</span>
            </span>
            <Icon name="auswahl" className="h-4 w-4 shrink-0 text-dezent" />
          </>
        }
        punkte={[
          { text: "Meine Daten", icon: "profil", href: EIGENE_DATEN_PFAD },
          { text: "Abmelden", icon: "abmelden", aktion: abmelden, trenner: true },
        ]}
      />
      {fehler && (
        <p role="alert" className="mt-1 px-2 text-xs text-credo-rot">
          {fehler}
        </p>
      )}
    </div>
  );
}
