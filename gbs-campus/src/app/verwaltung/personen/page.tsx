import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hatRecht, ladeAngemeldeten } from "@/lib/berechtigung";
import { RECHT, STATUS } from "@/lib/constants";
import { zahl } from "@/lib/einstellungen";
import { quoteAusVergangenen } from "@/lib/stundenplan";
import { terminVergangen } from "@/lib/selbstbestaetigung";
import { giltAlsBestanden } from "@/lib/leistung";
import { TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { ZurueckLeiste } from "@/components/ui/zurueck-leiste";
import { StatusBadge, TeilnahmeformBadge } from "@/components/ui/badges";
import { QuoteChip } from "@/components/ui/quote-ampel";
import { LadeHinweis } from "@/components/ui/lade-hinweis";
import { PersonAnlegen } from "./person-anlegen";

export const metadata = { title: "Personen" };
export const dynamic = "force-dynamic";

/** Mehr Treffer helfen niemandem — dann lieber genauer suchen oder filtern. */
const HOECHSTZAHL = 50;

export default async function PersonenSeite({
  searchParams,
}: {
  searchParams: Promise<{ suche?: string; status?: string; form?: string; semester?: string }>;
}) {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer || !hatRecht(benutzer, RECHT.PERSON_LESEN_ALLE)) redirect("/anmelden");

  const darfRollenVerwalten = hatRecht(benutzer, RECHT.BENUTZER_VERWALTEN);
  // Die „Noten (bestanden)"-Spalte ist eine pädagogische Sicht — nur mit
  // NOTEN_VERWALTEN, nicht für Verwaltung/Administrator (die tragen zwar
  // PERSON_LESEN_ALLE). Ohne das Recht wird die Spalte gar nicht gerendert.
  const darfNoten = hatRecht(benutzer, RECHT.NOTEN_VERWALTEN);
  const roh = await searchParams;
  const begriff = roh.suche?.trim() ?? "";
  const statusFilter = roh.status && (Object.values(STATUS) as string[]).includes(roh.status) ? roh.status : "";
  const formFilter = roh.form === "SCHUELER" || roh.form === "HOERER" ? roh.form : "";

  // Semester-Auswahl: „alle" hebt die Semester-Bindung auf; sonst der gewählte oder
  // (Standard) der laufende. Die Quote-/Teilnahme-Spalten beziehen sich darauf.
  const [alleSemester, statusListe, schwelle] = await Promise.all([
    prisma.semester.findMany({ select: { id: true, bezeichnung: true, istAktuell: true }, orderBy: { start: "desc" } }),
    prisma.teilnehmerStatus.findMany({ select: { code: true, bezeichnung: true } }),
    zahl("ANWESENHEIT_MINDEST_PROZENT"),
  ]);
  const aktuelles = alleSemester.find((s) => s.istAktuell) ?? null;
  const semesterModusAlle = roh.semester === "alle";
  const gewaehltesSemester = semesterModusAlle
    ? null
    : (roh.semester && alleSemester.find((s) => s.id === roh.semester)) || aktuelles;
  const effektivSemesterId = gewaehltesSemester?.id ?? null;

  const bedingungen: Prisma.PersonWhereInput[] = [];
  if (begriff) {
    bedingungen.push({
      OR: [
        { vorname: { contains: begriff, mode: "insensitive" } },
        { nachname: { contains: begriff, mode: "insensitive" } },
        { email: { contains: begriff, mode: "insensitive" } },
      ],
    });
  }
  if (statusFilter) bedingungen.push({ status: { code: statusFilter } });
  if (formFilter) {
    // Nur zählende Teilnahmen: Wer für das Semester abgemeldet ist, ist dort
    // weder Schüler noch Hörer.
    bedingungen.push({
      teilnahmen: {
        some: effektivSemesterId
          ? { semesterId: effektivSemesterId, teilnahmeform: formFilter, ...TEILNAHME_ZAEHLT }
          : { teilnahmeform: formFilter, ...TEILNAHME_ZAEHLT },
      },
    });
  }

  // Die Teilnahme des gewählten Semesters immer mitladen (leer, wenn keine
  // besteht) — ein statisches select lässt Prisma den Ergebnistyp exakt ableiten,
  // ohne Cast. Ohne gewähltes Semester ("alle") matcht der leere Scope nichts, und
  // die Quote-/Noten-Spalten bleiben leer. Eine für das Semester abgemeldete
  // Teilnahme zählt nicht (`TEILNAHME_ZAEHLT`): Teilnahme, Noten und Quote
  // bleiben dann leer wie bei „nicht eingeschrieben".
  const semesterScope = effektivSemesterId ?? "";

  const [personen, gesamtTermine] = await Promise.all([
    prisma.person.findMany({
      where: bedingungen.length ? { AND: bedingungen } : undefined,
      select: {
        id: true,
        vorname: true,
        nachname: true,
        email: true,
        status: { select: { code: true, bezeichnung: true } },
        teilnahmen: {
          where: { semesterId: semesterScope, ...TEILNAHME_ZAEHLT },
          select: {
            teilnahmeform: true,
            anwesenheiten: { select: { status: true, termin: { select: { beginn: true } } } },
            leistungen: { select: { ergebnis: true } },
          },
        },
      },
      orderBy: [{ nachname: "asc" }, { vorname: "asc" }],
      take: HOECHSTZAHL,
    }),
    effektivSemesterId ? prisma.unterrichtstermin.count({ where: { semesterId: effektivSemesterId } }) : Promise.resolve(0),
  ]);

  // Quote wie in der Detailakte (Modell A): nur vergangene Abende zählen als
  // teilgenommen/versäumt, künftige bleiben offen — gegen alle Abende gerechnet
  // stünde fast das ganze Semester jeder „unter Soll“ (Code-Review 4).
  const jetzt = new Date();
  const zeilen = personen.map((p) => {
    const t = p.teilnahmen[0];
    const vergangeneStati = t
      ? t.anwesenheiten.filter((a) => terminVergangen(a.termin.beginn, jetzt)).map((a) => a.status)
      : [];
    const bestanden = t ? t.leistungen.filter((l) => giltAlsBestanden(l.ergebnis)).length : 0;
    return {
      id: p.id,
      vorname: p.vorname,
      nachname: p.nachname,
      email: p.email,
      statusCode: p.status.code,
      statusLabel: p.status.bezeichnung,
      form: t?.teilnahmeform ?? null,
      quote: t && effektivSemesterId && gesamtTermine > 0 ? quoteAusVergangenen(vergangeneStati, gesamtTermine, schwelle) : null,
      noten: darfNoten && t && t.leistungen.length > 0 ? { bestanden, gesamt: t.leistungen.length } : null,
    };
  });

  const th = "whitespace-nowrap px-4 py-2.5 font-medium";
  const td = "whitespace-nowrap px-4 py-3";
  const selectKlasse = "min-h-11 rounded-lg border border-input bg-background px-3 py-2 text-sm";

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <ZurueckLeiste href="/verwaltung" label="Verwaltung" breadcrumb="Verwaltung · Personen" />

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Personen</h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Alle angelegten Personen. Eine Zeile öffnet die Detailakte mit Semester, Noten und Anwesenheit.
            {aktuelles && !semesterModusAlle && ` Noten und Quote beziehen sich auf ${gewaehltesSemester?.bezeichnung}.`}
          </p>
        </div>
      </div>

      <form method="get" className="mt-6 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="suche" className="sr-only">
            Nach Name oder E-Mail-Adresse suchen
          </label>
          <input
            id="suche"
            name="suche"
            type="search"
            defaultValue={begriff}
            placeholder="Name oder E-Mail-Adresse"
            className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-4 py-2.5 text-sm"
          />
        </div>
        <label htmlFor="status" className="sr-only">Status</label>
        <select id="status" name="status" defaultValue={statusFilter} className={selectKlasse}>
          <option value="">Status: alle</option>
          {statusListe.map((s) => (
            <option key={s.code} value={s.code}>
              {s.bezeichnung}
            </option>
          ))}
        </select>
        <label htmlFor="form" className="sr-only">Teilnahmeform</label>
        <select id="form" name="form" defaultValue={formFilter} className={selectKlasse}>
          <option value="">Teilnahme: alle</option>
          <option value="SCHUELER">Schüler</option>
          <option value="HOERER">Hörer</option>
        </select>
        <label htmlFor="semester" className="sr-only">Semester</label>
        <select id="semester" name="semester" defaultValue={semesterModusAlle ? "alle" : gewaehltesSemester?.id ?? "alle"} className={selectKlasse}>
          {alleSemester.map((s) => (
            <option key={s.id} value={s.id}>
              {s.bezeichnung}
              {s.istAktuell ? " · läuft" : ""}
            </option>
          ))}
          <option value="alle">Alle Semester</option>
        </select>
        <button type="submit" className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Anzeigen
        </button>
      </form>

      {darfRollenVerwalten && <PersonAnlegen />}

      {zeilen.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          {begriff || statusFilter || formFilter ? "Zu dieser Auswahl wurde niemand gefunden." : "Es ist noch niemand angelegt."}
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm text-muted-foreground">
            {zeilen.length === HOECHSTZAHL
              ? `Die ersten ${HOECHSTZAHL} Treffer — bitte genauer suchen oder filtern, wenn der Gesuchte fehlt.`
              : `${zeilen.length} ${zeilen.length === 1 ? "Person" : "Personen"}`}
          </p>

          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <caption className="sr-only">Personen — jede Zeile öffnet die Detailakte</caption>
              <thead className="bg-muted text-xs uppercase tracking-[0.04em] text-muted-foreground">
                <tr>
                  <th scope="col" className={th}>Name</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}>Teilnahme</th>
                  {darfNoten && <th scope="col" className={th}>Noten (bestanden)</th>}
                  <th scope="col" className={th}>Anwesenheit</th>
                  <th scope="col" className={`${th} sr-only`}>Öffnen</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((z) => (
                  <tr key={z.id} className="border-t border-border transition-colors hover:bg-muted/40">
                    <td className={td}>
                      <Link
                        href={`/verwaltung/personen/${z.id}`}
                        className="font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {z.nachname}, {z.vorname}
                        <LadeHinweis className="ml-2" />
                      </Link>
                      <span className="block text-xs text-muted-foreground">{z.email}</span>
                    </td>
                    <td className={td}>
                      <StatusBadge code={z.statusCode} label={z.statusLabel} />
                    </td>
                    <td className={td}>
                      {z.form ? <TeilnahmeformBadge form={z.form} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    {darfNoten && (
                      <td className={td}>
                        {z.noten ? (
                          <span className="tabular-nums">
                            {z.noten.bestanden}/{z.noten.gesamt}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    )}
                    <td className={td}>
                      {z.quote ? <QuoteChip quote={z.quote} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className={`${td} text-right`}>
                      <Link
                        href={`/verwaltung/personen/${z.id}`}
                        aria-label={`Akte von ${z.vorname} ${z.nachname} öffnen`}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-primary"
                      >
                        →
                        <LadeHinweis className="ml-1" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
