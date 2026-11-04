# SES EHR

Electronic health record for chronic disease management: patient registration and queueing, consultations with clinical decision support, investigations, pharmacy, billing and reports, plus a patient portal.

| Part | Folder | Stack | Port |
|---|---|---|---|
| API | `server/` | Express 5, Prisma 5, PostgreSQL | 5000 |
| Staff app | `client/` | React 19, Vite, TypeScript | 5173 |
| Patient portal | `patient-portal/` | React, Vite (PWA) | 5175 |
| CDS and documents | `cds-service/` | FastAPI, Ollama (Llama 3.2), ChromaDB, XGBoost | 8000 |

The staff app and portal proxy `/api` to the Express server, which calls the CDS service for suggestions, risk models and document extraction.

## Prerequisites

- **Node.js 22** and npm
- **PostgreSQL 14+** (create an empty database, e.g. `ses_ehr`)
- **Python 3.11**
- **Ollama** with two models: `ollama pull llama3.2` and `ollama pull nomic-embed-text`
- *Optional:* Tesseract OCR, for reading scanned documents (set `TESSERACT_CMD` if it is not in the default Windows location)

## First-time setup

```bash
git clone https://github.com/Humphriaano/SES.git
cd SES
```

**1. API and database**

```bash
cd server
npm install
cp .env.example .env          # then edit: DATABASE_URL and JWT_SECRET are required
npm run db:deploy             # creates every table
ADMIN_USERNAME=admin ADMIN_PASSWORD='choose-a-long-one' npm run create-admin
```

On Windows PowerShell, set the two variables first: `$env:ADMIN_USERNAME='admin'; $env:ADMIN_PASSWORD='...'; npm run create-admin`.

`create-admin` is needed because people who sign up start as *pending* with no role; only an admin can approve them. Run it again at any time to reset that admin's password.

**2. Staff app and portal**

```bash
cd ../client && npm install
cd ../patient-portal && npm install
```

**3. CDS service**

```bash
cd ../cds-service
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt      # Linux/macOS: .venv/bin/python
cp .env.example .env          # set DATABASE_URL (plain URL, no ?schema=)
```

## Running

Windows: `start-all.bat` opens each service in its own window (and two public tunnels if `cloudflared` is installed).

Or start them yourself, each in its own terminal:

```bash
cd server && npm run dev                                  # API, http://localhost:5000
cd client && npm run dev                                  # staff app, http://localhost:5173
cd patient-portal && npm run dev                          # portal, http://localhost:5175
cd cds-service && .venv/Scripts/python.exe -m uvicorn main:app --port 8000
ollama serve                                              # if not already running
```

The first time only, load the clinical guidelines into the search index (the CDS service must be running):

```bash
curl -X POST http://localhost:8000/cds/ingest
```

Check it worked: `curl http://localhost:8000/cds/health` reports Ollama status and the number of indexed chunks.

Sign in to the staff app at http://localhost:5173 with the admin you created. Staff register at `/signup`, and you approve them and assign roles under Admin → Users.

## Roles

`admin`, `clinician`, `nurse`, `pharmacist`, `lab_tech`, `receptionist`, `billing`. A user can hold several. Billing reports are limited to admin and billing.

## Configuration

- `server/.env` is documented in `server/.env.example`. VAPID, Brevo and WHO ICD-11 settings are optional.
- `cds-service/.env` is documented in `cds-service/.env.example`.
- Real `.env` files are git-ignored. Never commit them.

## Database changes

The schema lives in `server/prisma/schema.prisma`. After changing it:

```bash
cd server
npx prisma migrate dev --name describe_the_change   # creates and applies a migration
```

Commit the new folder under `server/prisma/migrations`. Other machines pick it up with `npm run db:deploy`.

`patient_documents` is created by the CDS service itself on first use; it is not part of the Prisma schema.

## Data that is not in the repository

- `.env` files (secrets).
- `cds-service/documents/`: uploaded patient documents.
- `cds-service/chroma_db/`: rebuilt by the ingest step above.
- The database itself. Back it up with `pg_dump`.

## Known issues

- Money is stored in ZMW; invoice numbers (`INV-YYYY-000001`) and receipt numbers (`RCT-…`) are sequential and never reused.
- Pharmacy stock control (receiving, dispensing, adjustments, reports) is built (see `server/docs/pharmacy-stock-stage*.md`). Facility products, batches and opening balances still have to be entered. Reorder suggestions, stock value and multi-store transfers are not built.

## Further reading

- `server/docs/`: per-stage notes for the pharmacy stock-control build.
- `risk-prediction-architecture.md`: how the chronic-disease risk models work.
- `SES Documentation/`: consultation notes spec.
- `client/README.md` and `patient-portal/README.md`: front-end notes.
