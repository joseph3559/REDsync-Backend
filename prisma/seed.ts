import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { PrismaClient } from "../generated/prisma";

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const email = "scottjoe3559@gmail.com";
  const exists = await prisma.user.findUnique({ where: { email } });
  if (!exists) {
    const hash = await bcrypt.hash("Scott@2030?", 10);
    await prisma.user.create({ 
      data: { 
        id: "default-user-id",
        email, 
        password: hash, 
        role: "super_admin" 
      } 
    });
    // eslint-disable-next-line no-console
    console.log("Seeded super-admin user.");
  } else {
    // eslint-disable-next-line no-console
    console.log("Super-admin already exists, skipping.");
  }

  // Seed company info
  const companyEntries: { key: string; value: string }[] = [
    { key: "company_name", value: "RED B.V." },
    { key: "address", value: "Einsteinstraat 37" },
    { key: "postal_code", value: "3316 GG" },
    { key: "place", value: "Dordrecht" },
    { key: "products_supplied", value: "Lecithin and lecithin based products" },
    { key: "years_on_site", value: "2 years" },
  ];
  for (const entry of companyEntries) {
    await prisma.companyInfo.upsert({
      where: { key: entry.key },
      update: { value: entry.value },
      create: { key: entry.key, value: entry.value },
    });
  }

  // Seed certifications
  const certs = ["FSMA", "HACCP", "FSSC22000", "Kosher", "Halal"];
  for (const name of certs) {
    const existing = await prisma.certification.findFirst({ where: { name } });
    if (!existing) {
      await prisma.certification.create({ data: { name } });
    }
  }
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


