COA Data Extraction API

Endpoints:
- POST /api/coa/upload (multipart field: files[] or files) — returns parsed JSON per PDF
- GET /api/coa/columns — returns columns from docs/COA Database.xlsm

Questionnaires API
------------------

- POST /api/questionnaires/upload
  - multipart/form-data: files[] (PDF/DOCX/XLSX)
  - Auth: Bearer token
  - Response: { questionnaireId, parsedQuestions }

- POST /api/questionnaires/process
  - JSON: { questionnaireId, parsedQuestions }
  - Auth: Bearer token
  - Response: { questionnaireId, processedFile, answersCount }

- GET /api/questionnaires/:id
  - Auth: Bearer token
  - Response: Questionnaire with answers and processedFile path

Env:
- OPENAI_API_KEY=sk-...
- OPENAI_MODEL=gpt-4o-mini
- JWT_SECRET=...
- PORT=4000

Assets:
- Place signature image at assets/signature.png

Python requirements (system):
- python3, pdfplumber or pdfminer.six, openai

