import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { PrismaClient } from "../generated/prisma/index.js";
import { app } from "./app.js";
dotenv.config();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "";
if (!JWT_SECRET) {
    // eslint-disable-next-line no-console
    console.warn("JWT_SECRET not set. Set it in .env");
}
function authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Missing or invalid Authorization header" });
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId;
        next();
    }
    catch {
        return res.status(401).json({ message: "Invalid token" });
    }
}
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
    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token });
});
app.get("/api/auth/me", authenticateJWT, async (req, res) => {
    const userId = req.userId;
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, role: true, createdAt: true, updatedAt: true },
    });
    if (!user)
        return res.status(404).json({ message: "User not found" });
    return res.json({ user });
});
app.get("/api/test", authenticateJWT, (req, res) => {
    return res.json({ message: "Authenticated route works" });
});
// Routers wired via app.ts
async function ensureSeed() {
    const email = "scottjoe3559@gmail.com";
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing)
        return;
    const hash = await bcrypt.hash("Scott@2030?", 10);
    await prisma.user.create({ data: { email, password: hash, role: "super_admin" } });
}
const port = Number(process.env.PORT || 4000);
app.listen(port, async () => {
    await ensureSeed();
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${port}`);
});
