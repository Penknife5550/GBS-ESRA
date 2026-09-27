import { type EigeneLeistungGruppe } from "@/lib/leistung-io";
import { giltAlsBestanden } from "@/lib/leistung";
import { Abschnitt, Gruppe, Zeile } from "@/components/ui/liste";
import { StatusPunkt, type StatusTon } from "@/components/ui/status-punkt";

/** Farbe des Punkts: dieselbe Regel wie das Ergebnis-Etikett (badges.tsx) — was
 * als bestanden gilt, entscheidet allein `giltAlsBestanden`. */
function ergebnisPunkt(ergebnis: string): StatusTon {
  if (giltAlsBestanden(ergebnis)) return "gruen";
  if (ergebnis === "NICHT_BESTANDEN") return "rot";
  if (ergebnis === "TEILGENOMMEN") return "blau";
  return "grau";
}

/**
 * Die eigenen Noten — rein lesend (Recht PERSON_LESEN_EIGENE). Erfasst werden sie
 * von Dozent oder Schulleitung. Als ruhige Gruppe je Semester: Fach, Titel der
 * Kurseinheit, rechts das Ergebnis und, wo benotet wird, Note und Punkte.
 * Serverkomponente ohne Interaktion.
 */
export function MeineNotenAbschnitt({ gruppen }: { gruppen: EigeneLeistungGruppe[] }) {
  return (
    <section>
      <Abschnitt titel="Meine Noten" />
      {gruppen.map((gruppe, i) => (
        <div key={gruppe.semesterBezeichnung} className={i > 0 ? "mt-4" : ""}>
          {gruppen.length > 1 && (
            <p className="mb-1.5 px-1 text-[13px] font-medium text-muted-foreground">{gruppe.semesterBezeichnung}</p>
          )}
          <Gruppe>
            {gruppe.leistungen.map((leistung) => {
              const zusatz = [leistung.note ? `Note ${leistung.note}` : null, leistung.punkte != null ? `${leistung.punkte} Punkte` : null]
                .filter(Boolean)
                .join(" · ");
              return (
                <Zeile
                  key={`${leistung.fach}·${leistung.titel}`}
                  titel={leistung.fach}
                  untertitel={leistung.titel}
                  rechts={
                    <div className="flex flex-col items-end gap-0.5">
                      <StatusPunkt ton={ergebnisPunkt(leistung.ergebnis)}>{leistung.ergebnisText}</StatusPunkt>
                      {zusatz && <span className="text-[13px] text-muted-foreground">{zusatz}</span>}
                    </div>
                  }
                />
              );
            })}
          </Gruppe>
        </div>
      ))}
    </section>
  );
}
