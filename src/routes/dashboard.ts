import { Router } from "express";
import { authenticate } from "../utils/jwtAuth";
import { PrismaClient } from "../../generated/prisma";
import { getQuestionnaires } from "../services/questionnaireService";

const router = Router();
const prisma = new PrismaClient();

router.get("/recent-activity", authenticate, async (req, res) => {
  try {
    const userId = (req as any).userId as string;
    const limit = parseInt((req.query.limit as string) || "10");

    // Get recent questionnaires
    const { questionnaires } = await getQuestionnaires(userId, "all", 5);
    
    // Get recent user activities (as proxy for other modules)
    const recentUsers = await prisma.user.findMany({
      take: 3,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        createdAt: true,
        updatedAt: true
      }
    });

    // Combine and format recent activities
    const activities = [];

    // Add questionnaire activities
    questionnaires.slice(0, 3).forEach(q => {
      activities.push({
        id: q.id,
        type: 'Questionnaire',
        name: q.originalFile.replace(/^.*[\\\/]/, ''),
        date: q.updatedAt,
        status: q.status === 'processed' ? 'Completed' : 
               q.status === 'draft' ? 'Draft' :
               q.status === 'processing' ? 'Processing' : 'Failed',
        module: 'questionnaires'
      });
    });

    // Add mock COA activities
    const coaActivities = [
      {
        id: 'coa-1',
        type: 'COA Analysis',
        name: 'Lecithin_Sample_2024_001.pdf',
        date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        status: 'Completed',
        module: 'coa-database'
      },
      {
        id: 'coa-2',
        type: 'COA Analysis',
        name: 'Organic_Lecithin_QC_Report.pdf',
        date: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        status: 'Processing',
        module: 'coa-database'
      }
    ];

    // Add mock Import/Export activities
    const tradeActivities = [
      {
        id: 'trade-1',
        type: 'Import Record',
        name: 'INDIA_IMPORT_292320_JAN24.xlsx',
        date: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
        status: 'Completed',
        module: 'import-export'
      },
      {
        id: 'trade-2',
        type: 'Export Record',
        name: 'INDIA_EXPORT_292320_JAN24.xlsx',
        date: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
        status: 'Completed',
        module: 'import-export'
      }
    ];

    // Combine all activities
    activities.push(...coaActivities, ...tradeActivities);

    // Sort by date (most recent first) and limit
    const sortedActivities = activities
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);

    res.json({
      activities: sortedActivities,
      total: activities.length
    });
  } catch (error) {
    console.error("Recent activity error:", error);
    res.status(500).json({ message: "Failed to fetch recent activity" });
  }
});

export default router;
