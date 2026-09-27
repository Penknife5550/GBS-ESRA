import { redirect } from "next/navigation";
import { ladeAngemeldeten, hatRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { ladeEigeneDozentKurseinheiten } from "@/lib/leistung-io";
import { NotenMatrix } from "@/components/noten/noten-matrix";
import { LeererZustand } from "@/components/ui/hinweis";
import { Abschnitt } from "@/components/ui/liste";
import { HandySeite } from "@/app/meine-daten/handy-seite";

export const metadata = { title: "Noten" };
export const dynamic = "force-dynamic";

/**
 * Die Noten der eigenen Fächer (Recht `NOTEN_ERFASSEN_EIGENE`) — früher der
 * Abschnitt „Meine Noten“ unten auf /dozent, seit dem Oberflächenplan 09/2026
 * eine eigene Seite hinter „Noten“ in der Leiste. Erfasst wird mit der
 * gemeinsamen Notenmatrix über `/api/dozent/note` (fach-scoped).
 */
export default async function DozentNotenSeite() {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer || !hatRecht(benutzer, RECHT.EIGENE_TERMINE_LESEN)) redirect("/anmelden");

  const darfNoten = hatRecht(benutzer, RECHT.NOTEN_ERFASSEN_EIGENE);
  const gruppen = darfNoten ? await ladeEigeneDozentKurseinheiten(benutzer.id) : [];

  return (
    <HandySeite ueber={gruppen.length === 1 ? gruppen[0].semesterBezeichnung : undefined} titel="Noten">
      {!darfNoten ? (
        <LeererZustand icon="abschluss" titel="Keine Notenerfassung">
          Ihr Konto darf keine Noten erfassen. Wenden Sie sich bei Fragen an die Schulleitung.
        </LeererZustand>
      ) : gruppen.length === 0 ? (
        <LeererZustand icon="abschluss" titel="Noch keine Fächer">
          Ihnen ist noch kein Fach mit Unterrichtsabenden zugeordnet. Die Zuordnung nimmt die Verwaltung im Stundenplan
          vor.
        </LeererZustand>
      ) : (
        <>
          {gruppen.map((g, i) => (
            <section key={g.semesterId} className={i > 0 ? "mt-7" : ""}>
              {gruppen.length > 1 && <Abschnitt titel={g.semesterBezeichnung} />}
              <NotenMatrix semesterId={g.semesterId} kurseinheiten={g.kurseinheiten} endpunkt="/api/dozent/note" />
            </section>
          ))}
          <p className="mt-3 px-1 text-[13px] text-muted-foreground">
            Hörer werden nicht benotet und stehen deshalb nicht in der Liste.
          </p>
        </>
      )}
    </HandySeite>
  );
}
