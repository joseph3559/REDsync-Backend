-- CreateTable
CREATE TABLE "public"."CompanyInfo" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyInfo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Certification" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "details" TEXT,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Questionnaire" (
    "id" TEXT NOT NULL,
    "originalFile" TEXT NOT NULL,
    "processedFile" TEXT,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "metadata" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Questionnaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QuestionnaireAnswer" (
    "id" TEXT NOT NULL,
    "questionnaireId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionnaireAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyInfo_key_key" ON "public"."CompanyInfo"("key");

-- CreateIndex
CREATE INDEX "Questionnaire_status_idx" ON "public"."Questionnaire"("status");

-- CreateIndex
CREATE INDEX "Questionnaire_createdAt_idx" ON "public"."Questionnaire"("createdAt");

-- CreateIndex
CREATE INDEX "QuestionnaireAnswer_questionnaireId_idx" ON "public"."QuestionnaireAnswer"("questionnaireId");

-- AddForeignKey
ALTER TABLE "public"."Questionnaire" ADD CONSTRAINT "Questionnaire_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuestionnaireAnswer" ADD CONSTRAINT "QuestionnaireAnswer_questionnaireId_fkey" FOREIGN KEY ("questionnaireId") REFERENCES "public"."Questionnaire"("id") ON DELETE CASCADE ON UPDATE CASCADE;
