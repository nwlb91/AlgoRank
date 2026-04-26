import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __algorankPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__algorankPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__algorankPrisma = prisma;
}
