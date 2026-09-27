import Link from "next/link";
import { redirect } from "next/navigation";
import { ladeMitRecht } from "@/lib/berechtigung";
import { RECHT } from "@/lib/constants";
import { anzahl, wartetSeit } from "@/lib/heute";
import { AnmeldungStatusBadge } from "@/components/ui/badges";
import { LeererZustand } from "@/components/ui/hinweis";
import { knopf } from "@/components/ui/knopf";
import { AnmeldungsListe, alsListenZeile, anmeldungsAnsicht, ladeAnmeldungsListe } from "./anmeldungs-liste";

export const metadata = { title: "Anmeldungen" };
export const dynamic = "force-dynamic";

/**
 * Anmeldungen wie ein Postfach (Oberflächenplan 09/2026): links die Liste
 * („Offen“ oder „Entschieden“), rechts die gewählte Anmeldung als lesbarer Text
 * mit „Aufnehmen“ und „Ablehnen …“ oben (/verwaltung/anmeldungen/[id]).
 *
 * Diese Seite öffnet bewusst keine Anmeldung von selbst: Jede Einzelansicht
 * steht im Protokoll, und ein Abruf soll nur entstehen, wenn jemand eine
 * Anmeldung wirklich öffnet. Am Handy steht nur die Liste.
 */
export default async function AnmeldungenSeite({ searchParams }: { searchParams: Promise<{ ansicht?: string }> }) {
  const benutzer = await ladeMitRecht(RECHT.ANMELDUNG_LESEN);
  if (!benutzer) redirect("/anmelden");

  const ansicht = anmeldungsAnsicht((await searchParams).ansicht);
  const { anzahlOffen, anmeldungen } = await ladeAnmeldungsListe(ansicht);
  const jetzt = new Date();
  const zeilen = anmeldungen.map((anmeldung) =>
    alsListenZeile(anmeldung, ansicht, jetzt, <AnmeldungStatusBadge status={anmeldung.status} />),
  );
  // Die Liste steht neueste zuerst — die älteste offene wartet am längsten.
  const aelteste = ansicht === "offen" ? anmeldungen[anmeldungen.length - 1] : undefined;

  return (
    <main className="lg:grid lg:h-[calc(100dvh-6px)] lg:grid-cols-[340px_minmax(0,1fr)]">
      <AnmeldungsListe ansicht={ansicht} anzahlOffen={anzahlOffen} zeilen={zeilen} ueberschrift="h1" />
      <div className="hidden items-center justify-center p-8 lg:flex">
        <div className="w-full max-w-md">
          {aelteste ? (
            <LeererZustand
              icon="eingang"
              titel={anzahl(anzahlOffen, "offene Anmeldung", "offene Anmeldungen")}
              aktion={
                <Link href={`/verwaltung/anmeldungen/${aelteste.id}`} prefetch={false} className={knopf("primaer")}>
                  Älteste lesen
                </Link>
              }
            >
              {aelteste.eingereichtAm
                ? `${anzahlOffen === 1 ? "Die Anmeldung" : "Die älteste"} ${wartetSeit(aelteste.eingereichtAm, jetzt)}.`
                : null}
            </LeererZustand>
          ) : (
            <LeererZustand icon="eingang" titel={ansicht === "offen" ? "Alles entschieden" : "Keine Anmeldung gewählt"}>
              {ansicht === "offen" ? "Zurzeit wartet keine Anmeldung auf eine Entscheidung." : "Wählen Sie links eine Anmeldung."}
            </LeererZustand>
          )}
        </div>
      </div>
    </main>
  );
}
