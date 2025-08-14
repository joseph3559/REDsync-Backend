import { Request, Response } from "express";
import { processImportExportFiles } from "../services/importExportService.js";

export async function handleProcessImportExport(req: Request, res: Response) {
  try {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) {
      return res.status(400).json({ message: "No files uploaded. Use 'files' field." });
    }
    const result = await processImportExportFiles({ files });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: "Failed to process files", error: String(err) });
  }
}


