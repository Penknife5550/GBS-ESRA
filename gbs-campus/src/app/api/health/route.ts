/**
 * Health-Endpoint für Docker-Healthcheck und externen Uptime-Ping.
 *
 * Warum das in Release 0.1 gehört (1_Bauplan.html Kap. 08, Definition of Done):
 * Der Login läuft ausschliesslich über E-Mail. Fällt die Anwendung, die
 * Datenbank oder der Mailversand aus, merkt es sonst niemand bis zum nächsten
 * Dienstagabend.
 *
 * Nach dem Review prüft er nicht mehr nur `SELECT 1`: Eine unvollständige
 * Konfiguration und ein fehlender SMTP-Zugang sperren faktisch alle aus, meldeten
 * hier aber weiterhin „ok". Ausgegeben wird nur, WAS fehlt — niemals ein Wert.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pruefeKonfiguration, smtpKonfiguriert } from "@/lib/konfiguration";

export const dynamic = "force-dynamic";

export async function GET() {
  const befunde = pruefeKonfiguration();
  const smtp = smtpKonfiguriert();
  const inProduktion = process.env.NODE_ENV === "production";

  let datenbank: "erreichbar" | "nicht erreichbar" = "erreichbar";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    datenbank = "nicht erreichbar";
  }

  // Ohne Mailversand kommt in Produktion nur hinein, wer ein Passwort hat — das
  // ist eine Störung, kein Hinweis.
  const stoerungen = [
    ...befunde.map((b) => `${b.name}: ${b.problem}`),
    ...(datenbank === "nicht erreichbar" ? ["Datenbank nicht erreichbar"] : []),
    ...(!smtp && inProduktion ? ["SMTP nicht konfiguriert — ohne Passwort kann sich niemand anmelden"] : []),
  ];

  if (stoerungen.length > 0) {
    // Keine Verbindungsdetails nach aussen, nur die Namen der betroffenen Punkte.
    return NextResponse.json({ error: "Nicht betriebsbereit", stoerungen }, { status: 503 });
  }

  return NextResponse.json({
    data: { status: "ok", datenbank, smtp: smtp ? "konfiguriert" : "nicht konfiguriert (Entwicklung)" },
  });
}
