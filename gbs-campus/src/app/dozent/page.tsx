import Link from "next/link";
import { redirect } from "next/navigation";
import { ladeAngemeldeten, hatRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { ladeEigeneDozentTermine } from "@/lib/stundenplan-io";
import { ladeEigeneDozentKurseinheiten } from "@/lib/leistung-io";
import { offeneErfassung } from "@/lib/stundenplan";
import { Icon, type IconName } from "@/components/icons";
import { AbmeldenKnopf } from "@/components/ui/abmelden-knopf";
import { LadeHinweis } from "@/components/ui/lade-hinweis";
import { NotenMatrix } from "@/components/noten/noten-matrix";
import { StundenplanDozent } from "./stundenplan-dozent";

export const metadata = { title: "Mein Unterricht" };
export const dynamic = "force-dynamic";

/**
 * Die Startseite des Dozenten. Er landet nach dem Login hier (Weiche in
 * `/verwaltung`). Über einer Übersicht aus echten Kennzahlen und den offenen
 * Aufgaben sieht er read-only seinen Stundenplan; für vergangene Abende trägt er
 * die Anwesenheit an der Quelle ein (Recht `ANWESENHEIT_ERFASSEN_EIGENE`), Noten
 * seiner eigenen Fächer (Recht `NOTEN_ERFASSEN_EIGENE`).
 */
export default async function DozentSeite() {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer || !hatRecht(benutzer, RECHT.EIGENE_TERMINE_LESEN)) redirect("/anmelden");

  const darfErfassen = hatRecht(benutzer, RECHT.ANWESENHEIT_ERFASSEN_EIGENE);
  const darfNoten = hatRecht(benutzer, RECHT.NOTEN_ERFASSEN_EIGENE);

  const [gruppen, notenGruppen] = await Promise.all([
    ladeEigeneDozentTermine(benutzer.id, new Date()),
    darfNoten ? ladeEigeneDozentKurseinheiten(benutzer.id) : Promise.resolve([]),
  ]);

  // Kennzahlen aus dem geladenen Stundenplan — keine zusätzlichen Abfragen.
  const alleTermine = gruppen.flatMap((g) => g.termine);
  const faecher = new Set(alleTermine.map((t) => t.fach).filter(Boolean)).size;
  const gehalten = alleTermine.filter((t) => t.istVergangen).length;

  const offeneAufgaben = offeneErfassung(gruppen);

  const tiles: { icon: IconName; label: string; wert: string; sub: string }[] = [
    { icon: "faecher", label: "Meine Fächer", wert: String(faecher), sub: faecher === 1 ? "Fach" : "Fächer" },
    { icon: "stundenplan", label: "Meine Abende", wert: String(alleTermine.length), sub: `${gehalten} gehalten` },
    {
      icon: "aufgabe",
      label: "Offene Erfassung",
      wert: String(offeneAufgaben.length),
      sub: offeneAufgaben.length === 1 ? "Abend offen" : "Abende offen",
    },
  ];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mein Unterricht</h1>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            Ihre Unterrichtsabende. Für vergangene Abende tragen Sie hier die Anwesenheit Ihrer Teilnehmer ein —
            anwesend, gefehlt oder nachgearbeitet.
          </p>
          <Link href="/meine-daten" className="mt-3 inline-block text-sm text-muted-foreground underline underline-offset-4">
            Meine persönlichen Daten (Adresse, Bankverbindung) →
            <LadeHinweis className="ml-2" />
          </Link>
        </div>
        <AbmeldenKnopf />
      </div>

      {gruppen.length === 0 ? (
        <p className="mt-10 rounded-lg border border-border bg-muted px-4 py-8 text-center text-sm text-muted-foreground">
          Ihnen sind noch keine Unterrichtsabende zugeordnet. Die Zuordnung nimmt die Verwaltung im Stundenplan vor.
        </p>
      ) : (
        <>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-border bg-muted text-primary">
                    <Icon name={t.icon} className="h-4 w-4" />
                  </span>
                  <span className="text-xs font-medium uppercase tracking-[0.06em]">{t.label}</span>
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums">{t.wert}</p>
                <p className="text-xs text-muted-foreground">{t.sub}</p>
              </div>
            ))}
          </div>

          {darfErfassen && offeneAufgaben.length > 0 && (
            <section className="mt-6 rounded-lg border border-border border-l-4 border-l-credo-gelb bg-card p-4">
              <h2 className="text-sm font-semibold">Offene Aufgaben</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Diese vergangenen Abende sind noch nicht vollständig erfasst. „Jetzt erfassen“ springt zum Abend im
                Stundenplan und klappt die Erfassung auf.
              </p>
              <ul className="mt-3 space-y-2">
                {offeneAufgaben.map((a) => (
                  <li
                    key={a.terminId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background p-3"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{a.text}</span>
                      {a.fach && <span className="text-muted-foreground"> · {a.fach}</span>}
                      <span className="block text-xs text-muted-foreground">{a.semester}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-full bg-credo-gelb/25 px-2.5 py-0.5 text-xs font-medium text-foreground">
                        {a.erfasst} von {a.gesamt} erfasst
                      </span>
                      {/* Ein schlichter Anker (kein next/link): Nur so feuert der
                          Browser `hashchange`, auf das der Stundenplan hört. */}
                      <a
                        href={`#termin-${a.terminId}`}
                        className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:border-primary"
                        aria-label={`Anwesenheit für ${a.text} jetzt erfassen`}
                      >
                        Jetzt erfassen
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section id="stundenplan" className="mt-8">
            <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Stundenplan &amp; Anwesenheit</h2>
            <div className="mt-4">
              <StundenplanDozent gruppen={gruppen} darfErfassen={darfErfassen} />
            </div>
          </section>
        </>
      )}

      {darfNoten && notenGruppen.length > 0 && (
        <section id="meine-noten" className="mt-12">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Meine Noten</h2>
          <p className="mt-2 mb-4 max-w-prose text-sm text-muted-foreground">
            Bewerten Sie die Teilnehmer Ihrer eigenen Fächer. Pflicht ist nur das Ergebnis; Punkte und Note sind optional
            (nur wo benotet wird, z. B. Bibelkunde). Hörer werden nicht benotet und stehen deshalb nicht in der Liste.
          </p>
          {notenGruppen.map((g) => (
            <div key={g.semesterId} className="mt-6 first:mt-0">
              <h3 className="mb-3 text-sm font-semibold">{g.semesterBezeichnung}</h3>
              <NotenMatrix semesterId={g.semesterId} kurseinheiten={g.kurseinheiten} endpunkt="/api/dozent/note" />
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
