import { redirect } from "next/navigation";
import { hatRecht, ladeAngemeldeten } from "@/lib/berechtigung";
import { RECHT, type RechtCode } from "@/lib/constants";
import { berlinerTag, tagLang, uhrzeit } from "@/lib/datum";
import { bereichFuer } from "@/lib/navigation";
import { LeererZustand } from "@/components/ui/hinweis";
import { kurzThema } from "../abend-text";
import { AnwesenheitAbschnitt, type AbendTag } from "../anwesenheit-abschnitt";
import { ladeMeineSemester, type MeinAbend } from "../daten";
import { HandySeite } from "../handy-seite";

export const metadata = { title: "Abende" };
export const dynamic = "force-dynamic";

/**
 * „Abende“ des Teilnehmers (Oberflächenplan 09/2026): je Semester die eigene
 * Quote als Ampel, darunter alle Abende nach Dienstagen — gehaltene mit Stand
 * und Selbstbestätigung, kommende als „geplant“. Bestätigt wird über
 * `/api/meine-daten/anwesenheit` (Recht PERSON_BEARBEITEN_EIGENE); was die
 * Schule erfasst hat, steht nur zum Nachlesen da.
 */
export default async function AbendeSeite() {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer || !hatRecht(benutzer, RECHT.PERSON_LESEN_EIGENE)) redirect("/anmelden");

  const semester = await ladeMeineSemester(benutzer.id, new Date());
  const bereich = bereichFuer((recht: RechtCode) => hatRecht(benutzer, recht));
  if (bereich !== "teilnehmer" && semester.length === 0) redirect("/meine-daten/ich");

  const darfBearbeiten = hatRecht(benutzer, RECHT.PERSON_BEARBEITEN_EIGENE);

  return (
    <HandySeite ueber={semester.length === 1 ? semester[0].bezeichnung : undefined} titel="Abende">
      {semester.length === 0 ? (
        <LeererZustand icon="kalender" titel="Noch keine Abende">
          Sobald Sie einem Semester zugeordnet sind, stehen hier Ihre Unterrichtsabende.
        </LeererZustand>
      ) : (
        <AnwesenheitAbschnitt
          darfBearbeiten={darfBearbeiten}
          gruppen={semester.map((s) => ({
            semesterBezeichnung: s.bezeichnung,
            teilnahmeId: s.teilnahmeId,
            quote: s.quote,
            tage: nachTagen(s.abende),
          }))}
        />
      )}
    </HandySeite>
  );
}

/** Die Einheiten je Unterrichtstag (Berliner Kalender), fertig formatiert. */
function nachTagen(abende: MeinAbend[]): AbendTag[] {
  const tage = new Map<string, AbendTag>();
  for (const abend of abende) {
    const schluessel = berlinerTag(abend.beginn);
    const tag = tage.get(schluessel) ?? { schluessel, titel: tagLang(abend.beginn), einheiten: [] };
    tag.einheiten.push({
      id: abend.id,
      zeit: uhrzeit(abend.beginn),
      fach: abend.fach,
      thema: kurzThema(abend.thema),
      istVergangen: abend.istVergangen,
      status: abend.status,
      darfBestaetigen: abend.darfBestaetigen,
    });
    tage.set(schluessel, tag);
  }
  return [...tage.values()];
}
