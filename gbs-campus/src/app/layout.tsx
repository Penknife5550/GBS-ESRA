import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
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

export const metadata: Metadata = {
  title: "GBS Campus",
  description: "Verwaltung der Gemeindebibelschule Minden",
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
