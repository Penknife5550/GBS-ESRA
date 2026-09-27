import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { datumZeitSekunden } from "@/lib/datum";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";

export const metadata = { title: "Protokoll" };
export const dynamic = "force-dynamic";

/** Mehr als das liest niemand am Stück — wer weiter zurück muss, filtert. */
const HOECHSTZAHL = 200;

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
    <main className="mx-auto max-w-3xl px-6 py-12">
      <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Protokoll" />

      <h1 className="mt-6 text-2xl font-bold tracking-tight">Protokoll</h1>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Wer hat wann was getan. Die letzten {HOECHSTZAHL} Einträge, neueste zuerst. Einträge lassen sich
        weder ändern noch löschen — auch nicht vom Administrator.
      </p>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        Hier stehen auch die Vorgänge, die sonst nirgends auftauchen. Zum Nachsehen lohnen sich etwa{" "}
        <code className="text-xs">ZUGANG_HILFE_GEMELDET</code>,{" "}
        <code className="text-xs">PASSWORT_ANMELDUNG_FEHLGESCHLAGEN</code>,{" "}
        <code className="text-xs">EMAIL_AENDERUNG_ADRESSE_VERGEBEN</code>,{" "}
        <code className="text-xs">ANMELDELINK_DURCH_VERWALTUNG</code> und{" "}
        <code className="text-xs">EMAIL_GEAENDERT_DURCH_VERWALTUNG</code>.
      </p>

      {/* Ein einfaches GET-Formular: Der Filter gehört in die Adresszeile,
          damit sich eine Suche weitergeben und neu laden lässt. */}
      <form method="get" className="mt-8 flex flex-wrap gap-3">
        <label htmlFor="aktion" className="sr-only">
          Nach einer Aktion filtern
        </label>
        <input
          id="aktion"
          name="aktion"
          type="search"
          defaultValue={begriff}
          placeholder="Aktion, z. B. PASSWORT"
          className="min-w-0 flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
        />
        <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Filtern
        </button>
      </form>

      {eintraege.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          {begriff ? `Zu „${begriff}" gibt es keinen Eintrag.` : "Es ist noch nichts protokolliert."}
        </p>
      ) : (
        <>
          <p className="mt-8 text-sm text-muted-foreground">
            {eintraege.length === HOECHSTZAHL
              ? `Die neuesten ${HOECHSTZAHL} Einträge — für ältere bitte nach der Aktion filtern.`
              : `${eintraege.length} ${eintraege.length === 1 ? "Eintrag" : "Einträge"}`}
          </p>

          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {eintraege.map((eintrag) => (
              <li key={eintrag.id} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{eintrag.aktion}</span>
                  <span className="text-xs text-muted-foreground">
                    {datumZeitSekunden(eintrag.erstelltAm)}
                  </span>
                </div>

                <p className="mt-1 text-sm text-muted-foreground">
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
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Alt- und Neuwerte anzeigen (können personenbezogene Daten enthalten)
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                      {JSON.stringify({ vorher: eintrag.vorher, nachher: eintrag.nachher }, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
