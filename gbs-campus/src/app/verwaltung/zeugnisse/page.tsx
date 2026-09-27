import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { berlinerTag, datum } from "@/lib/datum";
import { dmsAdresse } from "@/lib/konfiguration";
import { initialen } from "@/lib/navigation";
import { teilnahmeformName } from "@/lib/semester";
import { TEILNAHME_ZAEHLT } from "@/lib/teilnahme-filter";
import { tagMonat } from "@/lib/abendplan";
import { istGewaehlterTyp, zeugnisTitel, type GewaehlterTyp } from "@/lib/zeugnis";
import { ladeSammelVorschau, ladeZeugnisUebersicht, zaehleOffeneDmsArchivierungen } from "@/lib/zeugnis-io";
import {
  nichtsAuszustellenHinweis,
  sammellaufRueckfrage,
  sammellaufSperre,
  zaehleOffeneFaecher,
} from "@/lib/zeugnis-sammellauf";
import { LeererZustand } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { Segment } from "@/components/ui/segment";
import { Inhalt, Seitenkopf } from "@/components/ui/seitenkopf";
import { NotenZeugnisseFilter } from "../noten/noten-kopf";
import { DmsNachversand } from "./dms-nachversand";
import { ZeugnisClient, type NaechsterSchritt } from "./zeugnis-client";

export const metadata = { title: "Zeugnisse" };
export const dynamic = "force-dynamic";

type Notenstand = { bewertet: number; faecher: number };

/**
 * Stand der Noten je Schüler: wie viele Fächer seine Semester haben und wie
 * viele davon bewertet sind — dieselbe Rechnung wie die Rückfrage vor dem
 * Sammellauf (`ladeBewertungsstand` in zeugnis-io.ts), hier für alle Schüler der
 * Liste. Welche Fächer ein Semester hat, ergibt sich aus den Unterrichtsterminen;
 * das Abschlusszeugnis zählt alle Schüler-Semester bis einschließlich des
 * gewählten.
 */
async function ladeNotenstand(
  semester: { id: string; start: Date },
  typ: GewaehlterTyp,
  personIds: string[],
): Promise<Map<string, Notenstand>> {
  if (personIds.length === 0) return new Map();
  const teilnahmen = await prisma.teilnahme.findMany({
    where: {
      personId: { in: personIds },
      teilnahmeform: "SCHUELER",
      ...TEILNAHME_ZAEHLT,
      ...(typ === "ABSCHLUSS" ? { semester: { start: { lte: semester.start } } } : { semesterId: semester.id }),
    },
    select: { personId: true, semesterId: true, leistungen: { select: { kurseinheitId: true } } },
  });
  const semesterIds = [...new Set(teilnahmen.map((t) => t.semesterId))];
  const termine =
    semesterIds.length === 0
      ? []
      : await prisma.unterrichtstermin.findMany({
          where: { semesterId: { in: semesterIds }, kurseinheitId: { not: null } },
          distinct: ["semesterId", "kurseinheitId"],
          select: { semesterId: true, kurseinheitId: true },
        });
  const faecherVon = new Map<string, string[]>();
  for (const t of termine) {
    if (t.kurseinheitId) faecherVon.set(t.semesterId, [...(faecherVon.get(t.semesterId) ?? []), t.kurseinheitId]);
  }
  const stand = new Map<string, Notenstand>();
  for (const t of teilnahmen) {
    const erwartet = faecherVon.get(t.semesterId) ?? [];
    const offen = zaehleOffeneFaecher(erwartet, t.leistungen.map((l) => l.kurseinheitId));
    const bisher = stand.get(t.personId) ?? { bewertet: 0, faecher: 0 };
    stand.set(t.personId, { bewertet: bisher.bewertet + erwartet.length - offen, faecher: bisher.faecher + erwartet.length });
  }
  return stand;
}

/**
 * Was als Nächstes sinnvoll ist — der eine Hinweis über der Liste: vor dem
 * letzten Abend „ab dann dran“, danach fehlende Noten, dann das Ausstellen. Die
 * Sperre des Abschluss-Sammellaufs und „nichts mehr auszustellen“ gehen vor.
 */
function naechsterSchritt(e: {
  sperre: string | null;
  nichtsMehr: string | null;
  schueler: number;
  vollstaendig: number;
  hoerer: boolean;
  auszustellen: number;
  letzterAbend: Date | null;
  jetzt: Date;
}): NaechsterSchritt | null {
  if (e.sperre) return { titel: null, text: e.sperre, notenEintragen: false };
  if (e.auszustellen === 0) return e.nichtsMehr ? { titel: null, text: e.nichtsMehr, notenEintragen: false } : null;
  const notenFehlen = e.vollstaendig < e.schueler;
  const bewertet = `${e.vollstaendig} von ${e.schueler} ${e.schueler === 1 ? "Schüler ist" : "Schülern sind"} bewertet.`;
  const hoerer = e.hoerer ? " Hörer bekommen eine Teilnahmebescheinigung." : "";
  if (e.letzterAbend && berlinerTag(e.jetzt) < berlinerTag(e.letzterAbend)) {
    return {
      titel: `Zeugnisse sind ab dem letzten Abend am ${tagMonat(e.letzterAbend)} dran.`,
      text: (notenFehlen ? `Bis dahin fehlen die Noten: ${bewertet}` : "Die Noten sind vollständig.") + hoerer,
      notenEintragen: notenFehlen,
    };
  }
  if (notenFehlen) {
    return {
      titel: "Es fehlen noch Noten.",
      text: `${bewertet} Fehlende Fächer stehen sonst nicht im Zeugnis.${hoerer}`,
      notenEintragen: true,
    };
  }
  return {
    titel: "Die Noten sind vollständig.",
    text: `${e.auszustellen} ${e.auszustellen === 1 ? "Dokument ist" : "Dokumente sind"} noch nicht ausgestellt — „Alle ausstellen …“ oben rechts stellt sie aus.`,
    notenEintragen: false,
  };
}

/**
 * Zeugnis-Verwaltung der Schulleitung (Recht NOTEN_VERWALTEN), unter „Noten &
 * Zeugnisse“. Je Semester und Art (Semester- bzw. Abschlusszeugnis) die aktiven
 * Teilnehmer mit dem Stand ihrer Noten und ihres Dokuments — ohne gültiges mit
 * einem stornierten bzw. dem Hinweis, dass ein Hörer keinen besuchten Abend hat.
 * Eine Sammelaktion oben rechts, einzeln geht es über die Zeile (Blatt). Die
 * Zahlen für die Rückfrage vor dem Sammellauf und die Zahl der noch nicht im DMS
 * archivierten Zeugnisse ermittelt die Seite serverseitig.
 */
export default async function ZeugnisSeite({
  searchParams,
}: {
  searchParams: Promise<{ semester?: string; typ?: string }>;
}) {
  const benutzer = await ladeMitRecht(RECHT.NOTEN_VERWALTEN);
  if (!benutzer) redirect("/anmelden");

  const sp = await searchParams;
  const semesters = await prisma.semester.findMany({ orderBy: { start: "asc" } });

  if (semesters.length === 0) {
    return (
      <main>
        <Seitenkopf titel="Noten & Zeugnisse" />
        <Inhalt>
          <LeererZustand
            icon="zeugnis"
            titel="Noch ist kein Semester angelegt"
            aktion={
              <Link href="/verwaltung/semester" className={knopf("sekundaer")}>
                Zu den Semestern
              </Link>
            }
          />
        </Inhalt>
      </main>
    );
  }

  const laufend = semesters.find((s) => s.istAktuell);
  const gewaehltId = sp.semester ?? laufend?.id ?? semesters[0].id;
  const semester = semesters.find((s) => s.id === gewaehltId) ?? laufend ?? semesters[0];
  const typ: GewaehlterTyp = istGewaehlterTyp(sp.typ ?? "") ? (sp.typ as GewaehlterTyp) : "SEMESTER";

  const [zeilen, offenImDms, letzterTermin] = await Promise.all([
    ladeZeugnisUebersicht(semester.id, typ),
    zaehleOffeneDmsArchivierungen(),
    prisma.unterrichtstermin.findFirst({
      where: { semesterId: semester.id },
      orderBy: { beginn: "desc" },
      select: { beginn: true },
    }),
  ]);
  // Rückfrage vor „Alle ausstellen“: die Zahlen hier serverseitig ermitteln, nicht
  // im Browser schätzen.
  const [vorschau, notenstand] = await Promise.all([
    ladeSammelVorschau(semester, typ, zeilen),
    ladeNotenstand(
      semester,
      typ,
      zeilen.filter((z) => z.typ !== "BESCHEINIGUNG").map((z) => z.personId),
    ),
  ]);

  const schueler = zeilen.filter((z) => z.typ !== "BESCHEINIGUNG");
  const vollstaendig = schueler.filter((z) => {
    const s = notenstand.get(z.personId);
    return s !== undefined && s.faecher > 0 && s.bewertet >= s.faecher;
  }).length;
  const sperre = sammellaufSperre(typ, semester);
  const auszustellen = vorschau.zeugnisse + vorschau.bescheinigungen;
  const hinweis = nichtsAuszustellenHinweis(vorschau);

  // „Dran“ sind die Zeugnisse nach dem letzten Abend und mit allen Noten — vorher
  // bleibt die Sammelaktion möglich, tritt aber zurück.
  const jetzt = new Date();
  const letzterAbendVorbei = !letzterTermin || berlinerTag(jetzt) >= berlinerTag(letzterTermin.beginn);
  const sammelDran = letzterAbendVorbei && vollstaendig >= schueler.length;

  const artHref = (art: GewaehlterTyp) => `/verwaltung/zeugnisse?semester=${semester.id}&typ=${art}`;

  return (
    <main>
      <ZeugnisClient
        filter={<NotenZeugnisseFilter semesters={semesters} gewaehltId={semester.id} ansicht="zeugnisse" typ={typ} />}
        artWahl={
          <Segment
            label="Art des Dokuments"
            eintraege={[
              { text: "Semesterzeugnis", href: artHref("SEMESTER"), aktiv: typ === "SEMESTER" },
              { text: "Abschlusszeugnis", href: artHref("ABSCHLUSS"), aktiv: typ === "ABSCHLUSS" },
            ]}
          />
        }
        dms={<DmsNachversand offen={offenImDms} dmsEingerichtet={dmsAdresse() !== null} />}
        gewaehltId={semester.id}
        typ={typ}
        schritt={naechsterSchritt({
          sperre,
          nichtsMehr: hinweis,
          schueler: schueler.length,
          vollstaendig,
          hoerer: zeilen.some((z) => z.typ === "BESCHEINIGUNG"),
          auszustellen,
          letzterAbend: letzterTermin?.beginn ?? null,
          jetzt,
        })}
        sammelDran={sammelDran}
        sammellauf={{
          rueckfrage: sammellaufRueckfrage(vorschau, typ, semester.bezeichnung),
          sperre,
          auszustellen,
          hinweis,
        }}
        zeilen={zeilen.map((z) => {
          const [nachname = "", vorname = ""] = z.name.split(", ");
          const stand = notenstand.get(z.personId);
          return {
            personId: z.personId,
            name: z.name,
            initialen: initialen(vorname, nachname),
            teilnahmeformText: teilnahmeformName(z.teilnahmeform),
            typ: z.typ,
            typLabel: zeugnisTitel(z.typ),
            art: z.typ === "SEMESTER" ? "Semesterzeugnis" : zeugnisTitel(z.typ),
            noten: z.typ === "BESCHEINIGUNG" ? null : (stand ?? { bewertet: 0, faecher: 0 }),
            zeugnis: z.zeugnis
              ? { id: z.zeugnis.id, belegNr: z.zeugnis.belegNr, version: z.zeugnis.version, ausgestelltAm: datum(z.zeugnis.ausgestelltAm) }
              : null,
            storniert: z.storniert
              ? { id: z.storniert.id, belegNr: z.storniert.belegNr, storniertAm: datum(z.storniert.storniertAm) }
              : null,
            ohneAnwesenheit: z.besuchteFaecher === 0,
          };
        })}
      />
    </main>
  );
}
