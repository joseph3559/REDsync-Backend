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
// Helper middleware to verify JWT and extract user
async function verifyAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader)
        return res.status(401).json({ message: "No authorization header" });
    const token = authHeader.replace("Bearer ", "");
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = await prisma.user.findUnique({ where: { id: payload.userId } });
        if (!user)
            return res.status(401).json({ message: "User not found" });
        req.user = user;
        next();
    }
    catch {
        return res.status(401).json({ message: "Invalid token" });
    }
}
// Registration endpoint - creates pending user awaiting approval
app.post("/api/auth/register", async (req, res) => {
    const { email, password, role, name } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
    }
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        return res.status(409).json({ message: "Email already registered" });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
        data: {
            email,
            password: hash,
            role: role ?? "admin",
            status: "pending", // New users start as pending
            name: name || null
        },
        select: { id: true, email: true, role: true, status: true, name: true, createdAt: true, updatedAt: true },
    });
    return res.status(201).json({
        user,
        message: "Registration successful! Your account is pending approval by a super admin."
    });
});
// Login endpoint - only approved users can login
app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user)
        return res.status(401).json({ message: "Invalid credentials" });
    // Check if user is approved
    if (user.status !== "approved") {
        if (user.status === "pending") {
            return res.status(403).json({ message: "Your account is pending approval by an administrator" });
        }
        if (user.status === "rejected") {
            return res.status(403).json({ message: "Your account registration was not approved" });
        }
    }
    const ok = await bcrypt.compare(password, user.password);
    if (!ok)
        return res.status(401).json({ message: "Invalid credentials" });
    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token });
});
// Get pending users (Super admin only)
app.get("/api/auth/pending-users", verifyAuth, async (req, res) => {
    const user = req.user;
    if (user.role !== "super_admin") {
        return res.status(403).json({ message: "Only super admins can view pending users" });
    }
    const pendingUsers = await prisma.user.findMany({
        where: { status: "pending" },
        select: { id: true, email: true, name: true, role: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" }
    });
    return res.json({ users: pendingUsers });
});
// Get all users (Super admin only)
app.get("/api/auth/users", verifyAuth, async (req, res) => {
    const user = req.user;
    if (user.role !== "super_admin") {
        return res.status(403).json({ message: "Only super admins can view all users" });
    }
    const users = await prisma.user.findMany({
        select: { id: true, email: true, name: true, role: true, status: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: "desc" }
    });
    return res.json({ users });
});
// Approve user (Super admin only)
app.post("/api/auth/approve-user/:userId", verifyAuth, async (req, res) => {
    const user = req.user;
    if (user.role !== "super_admin") {
        return res.status(403).json({ message: "Only super admins can approve users" });
    }
    const { userId } = req.params;
    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { status: "approved", updatedAt: new Date() },
        select: { id: true, email: true, name: true, role: true, status: true }
    });
    return res.json({ user: updatedUser, message: "User approved successfully" });
});
// Reject user (Super admin only)
app.post("/api/auth/reject-user/:userId", verifyAuth, async (req, res) => {
    const user = req.user;
    if (user.role !== "super_admin") {
        return res.status(403).json({ message: "Only super admins can reject users" });
    }
    const { userId } = req.params;
    const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { status: "rejected", updatedAt: new Date() },
        select: { id: true, email: true, name: true, role: true, status: true }
    });
    return res.json({ user: updatedUser, message: "User rejected" });
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
