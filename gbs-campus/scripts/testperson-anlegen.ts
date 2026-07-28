/**
 * Legt für die Entwicklung eine Person mit einer Rolle an.
 * Aufruf: npx tsx scripts/testperson-anlegen.ts peter@beispiel.de SCHULLEITER
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [email, rolleCode] = process.argv.slice(2);
  if (!email || !rolleCode) {
    console.error("Aufruf: npx tsx scripts/testperson-anlegen.ts <email> <ROLLE>");
    process.exit(1);
  }

  const person = await prisma.person.upsert({
    where: { email: email.toLowerCase() },
    update: {},
    create: {
      vorname: "Peter",
      nachname: "Testleiter",
      email: email.toLowerCase(),
      statusCode: "AKTIV",
    },
  });

  await prisma.personRolle.upsert({
    where: { personId_rolleCode: { personId: person.id, rolleCode } },
    update: {},
    create: { personId: person.id, rolleCode },
  });

  console.log(`Person ${person.email} (${person.id}) hat jetzt die Rolle ${rolleCode}.`);
}

main()
  .catch((f) => {
    console.error(f);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
