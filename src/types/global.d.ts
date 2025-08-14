declare namespace NodeJS {
  interface ProcessEnv {
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    PORT?: string;
    JWT_SECRET?: string;
  }
}

declare namespace Express {
  interface Request {
    userId?: string;
  }
}

declare module "pdf-parse";
declare module "mammoth";


