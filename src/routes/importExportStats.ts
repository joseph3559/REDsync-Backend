import { Router } from "express";
import { PrismaClient } from "../../generated/prisma";
import { authenticate } from "../utils/jwtAuth";

const router = Router();
const prisma = new PrismaClient();

// Stats endpoint for dashboard
router.get("/stats", authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    
    // Get total records for this user, fallback to legacy data if none
    let totalRecords = await prisma.importExportRecord.count({
      where: { userId }
    });
    
    let distinctFiles = await prisma.importExportRecord.findMany({
      where: { userId },
      distinct: ['sourceFile'],
      select: { sourceFile: true }
    });
    
    let latestRecord = await prisma.importExportRecord.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true }
    });

    // If no user-specific data, use legacy data (null userId)
    if (totalRecords === 0) {
      totalRecords = await prisma.importExportRecord.count({
        where: { userId: null }
      });
      
      distinctFiles = await prisma.importExportRecord.findMany({
        where: { userId: null },
        distinct: ['sourceFile'],
        select: { sourceFile: true }
      });
      
      latestRecord = await prisma.importExportRecord.findFirst({
        where: { userId: null },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true }
      });
    }
    
    // Mock monthly uploads for now (could be calculated from actual data)
    const totalFiles = distinctFiles.length || 0;
    const monthlyUploads = [
      { month: "Jan", count: Math.floor(totalFiles * 0.15) },
      { month: "Feb", count: Math.floor(totalFiles * 0.12) },
      { month: "Mar", count: Math.floor(totalFiles * 0.18) },
      { month: "Apr", count: Math.floor(totalFiles * 0.20) },
      { month: "May", count: Math.floor(totalFiles * 0.25) },
      { month: "Jun", count: Math.floor(totalFiles * 0.10) }
    ];
    
    const stats = {
      totalRecords: totalRecords || 0,
      totalFiles: totalFiles,
      avgProcessingTime: 2.3, // Mock for now
      lastUploadDate: latestRecord?.createdAt?.toISOString() || null,
      monthlyUploads
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Failed to fetch import/export stats:', error);
    res.status(500).json({ message: "Failed to fetch import/export stats", error: String(error) });
  }
});

export default router;
