import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { EINRICHTUNG } from "@/lib/constants";
import "./globals.css";

/**
 * Montserrat wird hier geladen und selbst ausgeliefert.
 *
 * Vorher stand die Schrift nur als CSS-Variable in globals.css und wurde nie
 * eingebunden — die Anwendung lief faktisch in Arial, entgegen dem CREDO-CI.
 * `next/font` lädt die Dateien beim Bauen herunter und liefert sie von der
 * eigenen Domain aus; es geht also auch keine Anfrage an Google, was die
 * Einbindung datenschutzrechtlich unbedenklich macht.
 */
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-montserrat",
});

/**
 * Jede Seite setzt ihren eigenen Titel (`export const metadata = { title }`),
 * die Vorlage hängt „· GBS Campus" an — so unterscheiden sich Tabs, Verlauf und
 * die Ansage des Screenreaders (WCAG 2.4.2). Vorher erbten 24 von 32 Seiten
 * nur „GBS Campus". Personennamen stehen bewusst nicht im Titel: Er landet im
 * Browserverlauf und bei synchronisierten Browsern auch beim Anbieter.
 */
export const metadata: Metadata = {
  title: { default: "GBS Campus", template: "%s · GBS Campus" },
  description: `Verwaltung der ${EINRICHTUNG.name}`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={montserrat.variable}>
      <body>
        {/* CREDO-Linie: Grau, dann Gelb, Gruen, Rot, Blau */}
        <div className="flex h-[6px] w-full" aria-hidden="true">
          <div className="w-1/2 bg-primary" />
          <div className="w-[12.5%] bg-credo-gelb" />
          <div className="w-[12.5%] bg-credo-gruen" />
          <div className="w-[12.5%] bg-credo-rot" />
          <div className="w-[12.5%] bg-credo-blau" />
        </div>
        {children}
      </body>
    </html>
  );
}
