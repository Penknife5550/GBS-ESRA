import { Fragment } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { Abschnitt, Gruppe } from "@/components/ui/liste";
import { EinstellungsFeld } from "./einstellungs-feld";

export const metadata = { title: "Einstellungen" };
export const dynamic = "force-dynamic";

const BEREICH_NAME: Record<string, string> = {
  AUTH: "Anmeldung am Portal",
  ANMELDUNG: "Anmeldeformular",
  BEITRAG: "Beitrag",
  BETRIEB: "Betrieb",
  SEMESTER: "Semester",
  FINANZEN: "Finanzen",
};

/**
 * Einstellungen wie in den Systemeinstellungen (Oberflächenplan 09/2026): je
 * Bereich eine Gruppe, jede Zeile zeigt den geltenden Wert, geändert wird im
 * Blatt. Die Werte gelten sofort, jede Änderung steht im Protokoll, und die
 * Grenzen prüft der Server.
 */
export default async function EinstellungenSeite() {
  const benutzer = await ladeMitRecht(RECHT.SYSTEM_EINSTELLUNGEN);
  if (!benutzer) redirect("/anmelden");

  const einstellungen = await prisma.einstellung.findMany({
    orderBy: [{ bereich: "asc" }, { sortierung: "asc" }],
  });

  const bereiche = [...new Set(einstellungen.map((e) => e.bereich))];

  return (
    <main>
      <Seitenkopf titel="Einstellungen" />
      <Inhalt breite="lesen">
        {bereiche.map((bereich) => (
          <Fragment key={bereich}>
            <Abschnitt titel={BEREICH_NAME[bereich] ?? bereich} />
            <Gruppe>
              {einstellungen
                .filter((e) => e.bereich === bereich)
                .map((e) => (
                  <EinstellungsFeld
                    key={e.schluessel}
                    einstellung={{
                      schluessel: e.schluessel,
                      bezeichnung: e.bezeichnung,
                      beschreibung: e.beschreibung,
                      wert: e.wert,
                      minimum: e.minimum,
                      maximum: e.maximum,
                      einheit: e.einheit,
                    }}
                  />
                ))}
            </Gruppe>
          </Fragment>
        ))}
      </Inhalt>
    </main>
  );
}
