import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET || "";
export function authenticate(req, res, next) {
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
