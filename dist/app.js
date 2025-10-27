import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { PrismaClient } from "../generated/prisma/index.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
dotenv.config();
export const prisma = new PrismaClient();
export const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use("/processed", express.static(path.join(process.cwd(), "processed")));
// Auth routes (kept in server.ts for now)
const JWT_SECRET = process.env.JWT_SECRET || "";
// Inline auth endpoints so tests using `app` can authenticate
app.post("/api/auth/register", async (req, res) => {
    const { email, password, role } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        return res.status(409).json({ message: "Email already registered" });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
        data: { email, password: hash, role: role ?? "admin" },
        select: { id: true, email: true, role: true, createdAt: true, updatedAt: true },
    });
    return res.status(201).json({ user });
});
app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user)
        return res.status(401).json({ message: "Invalid credentials" });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok)
        return res.status(401).json({ message: "Invalid credentials" });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token });
});
// Feature routes
import coaRouter from "./routes/coa.js";
import importExportRouter from "./routes/importExport.js";
import questionnairesRouter from "./routes/questionnaires.js";
import importExportStatsRouter from "./routes/importExportStats.js";
import dashboardRouter from "./routes/dashboard.js";
import settingsRouter from "./routes/settings.js";
app.use("/api/coa", coaRouter);
app.use("/api/coa-database", coaRouter);
app.use("/api/import-export", importExportRouter);
app.use("/api/import-export", importExportStatsRouter);
app.use("/api/questionnaires", questionnairesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/settings", settingsRouter);
// Ensure directories used by uploads exist
function ensureDirs() {
    const dirs = [
        ["uploads", "coa"],
        ["uploads", "import-export"],
        ["uploads", "questionnaires"],
        ["processed", "questionnaires"],
        ["uploads", "settings", "logos"],
        ["uploads", "settings", "certifications"],
    ].map(parts => path.join(process.cwd(), ...parts));
    for (const d of dirs) {
        if (!fs.existsSync(d))
            fs.mkdirSync(d, { recursive: true });
    }
}
ensureDirs();
