/**
 * GBS Campus — der Rahmen um alle angemeldeten Seiten
 *
 * Oberflächenplan „Weniger suchen, schneller erledigt“ (09/2026): statt einer
 * Startseite mit 13 Kacheln eine feste Leiste links (Rechner) bzw. unten
 * (Handy, für Dozenten und Teilnehmer). Welche Punkte jemand sieht, regelt
 * `src/lib/navigation.ts` mit denselben Rechten wie früher die Kacheln.
 *
 * Wird von den Layouts unter /verwaltung, /dozent und /meine-daten eingesetzt.
 * Ohne Anmeldung zeichnet der Rahmen nichts dazu — die Seite selbst leitet dann
 * wie bisher zur Anmeldung um.
 */

import type { ReactNode } from "react";
import { prisma } from "@/lib/db";
import { hatRecht, ladeAngemeldeten } from "@/lib/berechtigung";
import { RECHT, type RechtCode } from "@/lib/constants";
import {
  DOZENT_NAV,
  MEIN_UNTERRICHT,
  TEILNEHMER_NAV,
  VERWALTUNG_HAUPT,
  VERWALTUNG_WEITERE,
  bereichFuer,
  initialen,
  rollenBezeichnung,
  sichtbarePunkte,
} from "@/lib/navigation";
import { LeistenNavigation, type LeistenGruppe } from "./leisten-navigation";
import { MobilKopf } from "./mobil-kopf";
import { ProfilMenue } from "./profil-menue";
import { Reiterleiste } from "./reiterleiste";
import { Suchfeld } from "./suchfeld";

function Marke({ semester }: { semester: string | null }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-primary text-[11px] font-bold tracking-wide text-primary-foreground"
      >
        GBS
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold text-foreground">GBS Campus</span>
        {semester && <span className="block truncate text-[11px] text-muted-foreground">{semester}</span>}
      </span>
    </div>
  );
}

export async function AppRahmen({ children }: { children: ReactNode }) {
  const benutzer = await ladeAngemeldeten();
  if (!benutzer) return <>{children}</>;

  const hat = (recht: RechtCode) => hatRecht(benutzer, recht);
  const bereich = bereichFuer(hat);
  const [semester, offeneAnmeldungen] = await Promise.all([
    prisma.semester.findFirst({ where: { istAktuell: true }, select: { bezeichnung: true } }),
    hat(RECHT.ANMELDUNG_LESEN) ? prisma.anmeldung.count({ where: { status: "EINGEREICHT" } }) : Promise.resolve(0),
  ]);

  const marke = <Marke semester={semester?.bezeichnung ?? null} />;
  const profil = (
    <ProfilMenue
      name={`${benutzer.vorname} ${benutzer.nachname}`}
      initialen={initialen(benutzer.vorname, benutzer.nachname)}
      rolle={rollenBezeichnung(benutzer.rollen)}
    />
  );

  if (bereich === "verwaltung") {
    const gruppen: LeistenGruppe[] = [
      {
        punkte: sichtbarePunkte(VERWALTUNG_HAUPT, hat).map((punkt) =>
          punkt.schluessel === "anmeldungen" ? { ...punkt, zahl: offeneAnmeldungen } : punkt,
        ),
      },
    ];
    const weitere = sichtbarePunkte(VERWALTUNG_WEITERE, hat);
    if (weitere.length > 0) gruppen.push({ titel: "Verwaltung", punkte: weitere });
    const unten: LeistenGruppe = { punkte: sichtbarePunkte([MEIN_UNTERRICHT], hat) };

    return (
      <div className="lg:grid lg:min-h-[calc(100dvh-6px)] lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-0 flex h-[calc(100dvh-6px)] flex-col border-r border-linie bg-leiste px-2.5 pb-3 pt-4">
            <div className="px-1.5 pb-4">{marke}</div>
            <div className="px-0.5 pb-3">
              <Suchfeld />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <LeistenNavigation gruppen={gruppen} />
            </div>
            <div className="mt-3 flex flex-col gap-1 border-t border-linie pt-3">
              {unten.punkte.length > 0 && <LeistenNavigation gruppen={[unten]} />}
              {profil}
            </div>
          </div>
        </aside>
        <div className="min-w-0">
          <MobilKopf
            gruppen={gruppen}
            unten={unten}
            marke={marke}
            suche={<Suchfeld id="mobil-suche" />}
            profil={profil}
            offeneAufgaben={offeneAnmeldungen}
          />
          {children}
        </div>
      </div>
    );
  }

  const punkte = bereich === "dozent" ? DOZENT_NAV : TEILNEHMER_NAV;
  return (
    <div className="lg:grid lg:min-h-[calc(100dvh-6px)] lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <div className="sticky top-0 flex h-[calc(100dvh-6px)] flex-col border-r border-linie bg-leiste px-2.5 pb-3 pt-4">
          <div className="px-1.5 pb-5">{marke}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <LeistenNavigation gruppen={[{ punkte: [...punkte] }]} />
          </div>
          <div className="mt-3 border-t border-linie pt-3">{profil}</div>
        </div>
      </aside>
      <div className="min-w-0 pb-[calc(env(safe-area-inset-bottom)+5rem)] lg:pb-0">{children}</div>
      <Reiterleiste punkte={punkte} />
    </div>
  );
}
