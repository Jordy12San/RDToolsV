# RDToolsV (Renovatie Direct • Visualisatietool)

Synchronous (geen wachtrij) image-edit flow met Next.js 15 + Vercel Blob.

## Install
- Zet `OPENAI_API_KEY` en `BLOB_READ_WRITE_TOKEN` in Vercel (Project → Settings → Environment Variables).
- Deploy, of lokaal:
  npm install
  cp .env.example .env   # vul je keys in als je lokaal test
  npm run dev

## Endpoints
- POST `/api/generate-sync` — ontvangt { prompt, base(dataURL) } en geeft { url } terug

## Frontend
- `app/page.tsx` bevat upload, kleurkeuze, en voortgangssimulatie.
