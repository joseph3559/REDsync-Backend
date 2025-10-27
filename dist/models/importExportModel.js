import { PrismaClient } from "../../generated/prisma/index.js";
const prisma = new PrismaClient();
export const ImportExportModel = {
    async insert(record) {
        return prisma.importExportRecord.create({ data: record });
    },
};
