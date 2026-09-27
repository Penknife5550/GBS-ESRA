import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { datumZeitSekunden } from "@/lib/datum";
import { Icon } from "@/components/icons";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { Segment } from "@/components/ui/segment";
import { Gruppe } from "@/components/ui/liste";
import { LeererZustand } from "@/components/ui/hinweis";

export const metadata = { title: "Protokoll" };
export const dynamic = "force-dynamic";

/** Mehr als das liest niemand am Stück — wer weiter zurück muss, filtert. */
const HOECHSTZAHL = 200;

/**
 * Schnellfilter als Umschalter (Oberflächenplan 09/2026) — die Vorgänge, die
 * sonst nirgends auftauchen: ZUGANG_HILFE_GEMELDET, PASSWORT_ANMELDUNG_FEHLGESCHLAGEN,
 * EMAIL_AENDERUNG_ADRESSE_VERGEBEN, ANMELDELINK_DURCH_VERWALTUNG und
 * EMAIL_GEAENDERT_DURCH_VERWALTUNG. Jeder Begriff ist ein Teiltreffer auf die Aktion.
 */
const SCHNELLFILTER = [
  { text: "Alle", begriff: "" },
  { text: "Fehlgeschlagen", begriff: "FEHLGESCHLAGEN" },
  { text: "Zugangshilfe", begriff: "ZUGANG_HILFE" },
  { text: "Passwort", begriff: "PASSWORT" },
  { text: "E-Mail", begriff: "EMAIL" },
  { text: "Durch die Verwaltung", begriff: "DURCH_VERWALTUNG" },
] as const;

/**
 * Das Protokoll — die Leseseite zum Audit-Log.
 *
 * Das Recht `AUDIT_LESEN` gab es von Anfang an, die Tabelle wird seit dem
 * ersten Tag gefüllt, und der DELETE-Trigger schützt sie auf Datenbankebene.
 * Nur: Keine einzige Oberfläche las sie. Damit waren genau die Vorgänge
 * unsichtbar, die absichtlich still ablaufen und deshalb nirgendwo sonst
 * auftauchen — eine bei der Adressänderung schon vergebene E-Mail-Adresse, eine
 * Meldung aus dem Hilfeformular, ein fehlgeschlagener Passwortversuch, ein von
 * der Verwaltung verschickter Anmeldelink oder eine von ihr geänderte Adresse.
 * Nach dem Leitsatz dieses Projekts war das kaputt: Was der Betrieb nicht sehen
 * kann, gibt es nicht.
 *
 * Bewusst nur lesend und ohne Löschweg: Ein Protokoll, das sich aus der
 * Anwendung heraus aufräumen ließe, wäre keins.
 */
export default async function ProtokollSeite({
  searchParams,
}: {
  searchParams: Promise<{ aktion?: string }>;
}) {
  const benutzer = await ladeMitRecht(RECHT.AUDIT_LESEN);
  if (!benutzer) redirect("/anmelden");

  const { aktion } = await searchParams;
  const begriff = aktion?.trim() ?? "";
  const schnellfilter = SCHNELLFILTER.find((f) => f.begriff.toLowerCase() === begriff.toLowerCase());

  const eintraege = await prisma.auditLog.findMany({
    // Teiltreffer statt exakter Gleichheit: „PASSWORT" findet alle Vorgänge um
    // das Passwort, ohne dass man den vollen Code auswendig kennen muss.
    where: begriff ? { aktion: { contains: begriff, mode: "insensitive" } } : undefined,
    orderBy: { erstelltAm: "desc" },
    take: HOECHSTZAHL,
    select: {
      id: true,
      aktion: true,
      quelle: true,
      objektTyp: true,
      objektId: true,
      ipAdresse: true,
      erstelltAm: true,
      vorher: true,
      nachher: true,
      akteur: { select: { vorname: true, nachname: true } },
    },
  });

  return (
    <main>
      <Seitenkopf
        titel="Protokoll"
        aktionen={
          // Ein einfaches GET-Formular: Der Filter gehört in die Adresszeile,
          // damit sich eine Suche weitergeben und neu laden lässt. Eingabetaste sucht.
          <form method="get" role="search" className="relative w-full lg:w-64">
            <label htmlFor="aktion" className="sr-only">
              Nach einer Aktion filtern
            </label>
            <Icon
              name="suche"
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dezent"
            />
            <input
              key={begriff}
              id="aktion"
              name="aktion"
              type="search"
              defaultValue={schnellfilter ? "" : begriff}
              placeholder="Aktion suchen, z. B. HONORAR"
              autoComplete="off"
              className="h-11 w-full rounded-lg bg-feld pl-8 pr-2.5 text-sm text-foreground placeholder:text-dezent focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 lg:h-8 lg:text-[13px]"
            />
          </form>
        }
      >
        <Segment
          label="Protokoll filtern"
          eintraege={SCHNELLFILTER.map((f) => ({
            text: f.text,
            href: f.begriff ? `/verwaltung/protokoll?aktion=${f.begriff}` : "/verwaltung/protokoll",
            aktiv: f === schnellfilter,
          }))}
        />
      </Seitenkopf>

      <Inhalt breite="mittel">
        {eintraege.length === 0 ? (
          <LeererZustand
            icon="protokoll"
            titel={begriff ? `Zu „${schnellfilter?.text ?? begriff}“ gibt es keinen Eintrag.` : "Es ist noch nichts protokolliert."}
          />
        ) : (
          <>
            <p className="mb-2 text-[13px] text-muted-foreground">
              {eintraege.length === HOECHSTZAHL
                ? `Die neuesten ${HOECHSTZAHL} Einträge — für ältere bitte nach der Aktion filtern.`
                : `${eintraege.length} ${eintraege.length === 1 ? "Eintrag" : "Einträge"}, neueste zuerst`}
            </p>

            <Gruppe>
              {eintraege.map((eintrag) => (
                <div key={eintrag.id} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4">
                  <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground sm:w-40 sm:pt-px">
                    {datumZeitSekunden(eintrag.erstelltAm)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-foreground">{eintrag.aktion}</p>
                    <p className="break-words text-[13px] text-muted-foreground">
                      {eintrag.akteur
                        ? `${eintrag.akteur.vorname} ${eintrag.akteur.nachname}`
                        : eintrag.quelle === "SYSTEM"
                          ? "System"
                          : "unbekannt"}{" "}
                      · {eintrag.objektTyp}
                      {eintrag.objektId ? ` ${eintrag.objektId}` : ""}
                      {eintrag.ipAdresse ? ` · ${eintrag.ipAdresse}` : ""}
                    </p>

                    {/* Alt- und Neuwerte sind JSON und können Namen, Adressen oder
                        E-Mail-Adressen enthalten. Deshalb eingeklappt: Wer die
                        Liste überfliegt oder sie jemandem über die Schulter zeigt,
                        sieht sie nicht beiläufig mit. Geheimnisse (IBAN, Hashes)
                        entfernt bereits `lib/audit.ts` beim Schreiben. */}
                    {(eintrag.vorher !== null || eintrag.nachher !== null) && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs font-medium text-primary">
                          Alt- und Neuwerte anzeigen (können personenbezogene Daten enthalten)
                        </summary>
                        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                          {JSON.stringify({ vorher: eintrag.vorher, nachher: eintrag.nachher }, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </Gruppe>

            <p className="mt-3 text-xs text-muted-foreground">
              Einträge lassen sich weder ändern noch löschen — auch nicht vom Administrator.
            </p>
          </>
        )}
      </Inhalt>
    </main>
  );
}
