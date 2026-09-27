import { type EigeneLeistungGruppe } from "@/lib/leistung-io";
import { ErgebnisBadge } from "@/components/ui/badges";

/**
 * Die eigenen Noten des Schülers — rein lesend (Recht PERSON_LESEN_EIGENE).
 * Erfasst werden sie von Dozent oder Schulleitung; hier stehen sie nur zum
 * Nachlesen. Serverkomponente ohne Interaktion.
 */
export function MeineNotenAbschnitt({ gruppen }: { gruppen: EigeneLeistungGruppe[] }) {
  return (
    <div>
      <p className="max-w-prose text-sm text-muted-foreground">
        Deine Bewertungen je Semester. Erfasst werden sie von deinem Dozenten oder der Schulleitung.
      </p>

      {gruppen.map((gruppe) => (
        <div key={gruppe.semesterBezeichnung} className="mt-6">
          <h3 className="text-sm font-semibold">{gruppe.semesterBezeichnung}</h3>
          <ul className="mt-3 space-y-2">
            {gruppe.leistungen.map((leistung) => (
              <li
                key={`${leistung.fach}·${leistung.titel}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium">{leistung.fach}</span>
                  <span className="ml-2 text-sm text-muted-foreground">· {leistung.titel}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ErgebnisBadge ergebnis={leistung.ergebnis} />
                  {leistung.punkte != null && (
                    <span className="text-sm text-muted-foreground">{leistung.punkte} Punkte</span>
                  )}
                  {leistung.note && <span className="text-sm text-muted-foreground">Note {leistung.note}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
