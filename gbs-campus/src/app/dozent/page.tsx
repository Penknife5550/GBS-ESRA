import { redirect } from "next/navigation";
import { ladeAngemeldeten, hatRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { tagLang } from "@/lib/datum";
import { ladeEigeneDozentKurseinheiten } from "@/lib/leistung-io";
import { KalenderBlock } from "@/components/ui/anzeige";
import { LeererZustand } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { Abschnitt, Gruppe, Zeile } from "@/components/ui/liste";
import { LadeHinweis } from "@/components/ui/lade-hinweis";
import { StatusPunkt } from "@/components/ui/status-punkt";
import { HandySeite, KARTE } from "@/app/meine-daten/handy-seite";
import { ladeDozentUebersicht, type DozentUebersicht, type KartenAbend } from "./daten";
import { StundenplanDozent } from "./stundenplan-dozent";

export const metadata = { title: "Mein Unterricht" };
export const dynamic = "force-dynamic";

/**
 * „Mein Unterricht“ — die Startseite des Dozenten (Weiche in `/verwaltung`).
 * Oberflächenplan 09/2026, Vorlage b1: oben das Offene mit einem großen Knopf,
 * darunter der nächste Abend mit Thema, dann alle Abende mit Stand. Erfasst wird
 * die Anwesenheit im Blatt (Recht `ANWESENHEIT_ERFASSEN_EIGENE`), die Noten der
 * eigenen Fächer stehen auf /dozent/noten (Recht `NOTEN_ERFASSEN_EIGENE`).
 */
export default async function DozentSeite() {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer || !hatRecht(benutzer, RECHT.EIGENE_TERMINE_LESEN)) redirect("/anmelden");

  const darfErfassen = hatRecht(benutzer, RECHT.ANWESENHEIT_ERFASSEN_EIGENE);
  const darfNoten = hatRecht(benutzer, RECHT.NOTEN_ERFASSEN_EIGENE);

  const [uebersicht, notenGruppen] = await Promise.all([
    ladeDozentUebersicht(benutzer.id, new Date()),
    darfNoten ? ladeEigeneDozentKurseinheiten(benutzer.id) : Promise.resolve([]),
  ]);
  const { gruppen, offen, weitereOffen, naechste } = uebersicht;
  const hatGehaltene = gruppen.some((g) => g.abende.some((a) => a.istVergangen));

  // Am Handy untereinander, am Rechner nebeneinander.
  const oben = (
    <div className="grid gap-3.5 lg:grid-cols-2">
      {darfErfassen && offen && <OffenKarte abend={offen} weitere={weitereOffen} />}
      {darfErfassen && !offen && hatGehaltene && <ErfasstKarte />}
      {naechste.length > 0 && <NaechsterAbendKarte einheiten={naechste} />}
    </div>
  );

  return (
    <HandySeite ueber={uebersicht.semester} titel="Unterricht">
      {gruppen.length === 0 ? (
        <LeererZustand icon="kalender" titel="Noch keine Abende">
          Ihnen sind noch keine Unterrichtsabende zugeordnet. Die Zuordnung nimmt die Verwaltung im Stundenplan vor.
        </LeererZustand>
      ) : (
        <StundenplanDozent gruppen={gruppen} darfErfassen={darfErfassen} oben={oben} />
      )}

      {darfNoten && notenGruppen.length > 0 && (
        <section className="mt-7">
          <Abschnitt titel="Meine Noten" />
          <Gruppe>
            {notenGruppen.flatMap((g) =>
              g.kurseinheiten.map((k) => {
                const gesamt = k.teilnehmer.length;
                const benotet = k.teilnehmer.filter((t) => k.leistungen[t.teilnahmeId]?.ergebnis).length;
                return (
                  <Zeile
                    key={`${g.semesterId}-${k.kurseinheitId}`}
                    href="/dozent/noten"
                    titel={
                      <>
                        {k.fach}
                        <LadeHinweis className="ml-2" />
                      </>
                    }
                    untertitel={notenGruppen.length > 1 ? `${k.titel} · ${g.semesterBezeichnung}` : k.titel}
                    rechts={
                      <StatusPunkt ton={gesamt > 0 && benotet === gesamt ? "gruen" : benotet > 0 ? "gelb" : "grau"}>
                        {benotet} von {gesamt}
                      </StatusPunkt>
                    }
                  />
                );
              }),
            )}
          </Gruppe>
        </section>
      )}
    </HandySeite>
  );
}

/** Die Aufgabe oben: Anwesenheit eines gehaltenen Abends fehlt noch. */
function OffenKarte({ abend, weitere }: { abend: KartenAbend; weitere: DozentUebersicht["weitereOffen"] }) {
  const stand =
    abend.erfasst === 0
      ? "Noch niemand ist erfasst."
      : abend.selbst === abend.erfasst
        ? `${abend.selbst} von ${abend.gesamt} haben sich schon selbst eingetragen`
        : abend.selbst > 0
          ? `${abend.erfasst} von ${abend.gesamt} erfasst, ${abend.selbst} davon selbst eingetragen`
          : `${abend.erfasst} von ${abend.gesamt} erfasst`;
  return (
    <section aria-labelledby="offen-titel" className={KARTE}>
      <StatusPunkt ton="gelb" className="text-[15px] font-semibold">
        Offen
      </StatusPunkt>
      <h2 id="offen-titel" className="mt-1.5 text-[17px] font-semibold leading-snug tracking-tight text-foreground">
        {`Anwesenheit vom ${abend.tagMitName}`}
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {[abend.fach, abend.kurzThema].filter(Boolean).join(" · ")}
      </p>
      <p className="text-sm text-muted-foreground">{stand}</p>
      {/* Ein schlichter Anker (kein next/link) auf den Abend in der Liste: Die
          Liste fängt den Klick ab und öffnet das Blatt (als Adresse mit
          #termin-… auch von außen). Ohne JavaScript springt er zum Abend. */}
      <a
        href={`#termin-${abend.id}`}
        className={`${knopf("primaer", "gross")} mt-3.5`}
        aria-label={`Anwesenheit vom ${abend.tagMitName} jetzt erfassen`}
      >
        Jetzt erfassen
      </a>
      {weitere.length > 0 && (
        <>
          <p className="mt-3.5 text-[13px] text-muted-foreground">Außerdem noch offen:</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {weitere.map((w) => (
              <a
                key={w.id}
                href={`#termin-${w.id}`}
                className={knopf("sekundaer", "klein")}
                aria-label={`Anwesenheit vom ${w.tagMitName} erfassen`}
              >
                {w.tag}
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** Ruhige Bestätigung, wenn nichts offen ist — an der Stelle der Karte „Offen“. */
function ErfasstKarte() {
  return (
    <section className={KARTE}>
      <StatusPunkt ton="gruen" className="text-[15px] font-semibold">
        Erfasst
      </StatusPunkt>
      <p className="mt-1.5 text-sm text-muted-foreground">Die Anwesenheit aller gehaltenen Abende ist vollständig.</p>
    </section>
  );
}

/** Der nächste eigene Unterrichtstag mit Uhrzeit, Fach, Thema und Teilnehmerzahl. */
function NaechsterAbendKarte({ einheiten }: { einheiten: KartenAbend[] }) {
  const erster = einheiten[0];
  return (
    <section aria-labelledby="naechster-titel" className={`${KARTE} flex items-start gap-4`}>
      <KalenderBlock datum={erster.beginn} className="pt-0.5" />
      <div className="min-w-0">
        <h2 id="naechster-titel" className="text-[13px] font-medium text-muted-foreground">
          Nächster Abend<span className="sr-only">{`: ${tagLang(erster.beginn)}`}</span>
        </h2>
        {einheiten.map((e) => (
          <div key={e.id} className="mt-0.5">
            <p className="text-base font-semibold text-foreground">{[e.zeit, e.fach].filter(Boolean).join(" · ")}</p>
            {e.thema && <p className="text-[15px] text-foreground">{e.thema}</p>}
          </div>
        ))}
        <p className="mt-1 text-[13px] text-muted-foreground">{`${erster.teilnehmer} Teilnehmer`}</p>
      </div>
    </section>
  );
}
