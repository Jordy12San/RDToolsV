"use client";

import { useEffect, useRef, useState } from "react";

// ===== Types =====
type Step = "idle" | "scaling" | "ready" | "generating" | "done" | "error";

// Zet op true om zonder backend te kunnen testen
const USE_FAKE_API = false; // productie-standaard (zet tijdelijk op true om lokaal te testen)

// Heel klein 1x1 PNG (groen) voor mock-download/preview
const MOCK_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAoMBg5l3o+8AAAAASUVORK5CYII=";

export default function HomePage() {
  // ===== UI state =====
  const [step, setStep] = useState<Step>("idle");
  const [statusText, setStatusText] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [voorImage, setVoorImage] = useState<string | null>(null);
  const [naImage, setNaImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // Keuzes
  const [kleurVal, setKleurVal] = useState<string>(
    "Antraciet (RAL 7016) • verdiept profiel"
  );
  const [kleurHex, setKleurHex] = useState<string>("#383E42");
  const [finishVal, setFinishVal] = useState<string>("Mat");

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const preparedBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    setStatusText("");
    setProgress(0);
  }, []);

  // Ruim object-URLs op als ze vervangen of bij unmount
  useEffect(() => () => { if (voorImage) URL.revokeObjectURL(voorImage); }, [voorImage]);
  useEffect(() => () => { if (naImage) URL.revokeObjectURL(naImage); }, [naImage]);

  // ===== Helpers =====
  async function scaleTo512(file: File): Promise<{ blob: Blob; url: string }>{
    // Respecteer EXIF-rotatie waar mogelijk via createImageBitmap
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fallback naar <img>.decode() bij oudere browsers
      const url = URL.createObjectURL(file);
      const img = document.createElement("img");
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 512; canvas.height = 512;
      const ctx = canvas.getContext("2d")!;
      const scale = Math.max(512 / img.naturalWidth, 512 / img.naturalHeight);
      const dw = Math.round(img.naturalWidth * scale), dh = Math.round(img.naturalHeight * scale);
      const dx = Math.round((512 - dw) / 2), dy = Math.round((512 - dh) / 2);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 512, 512);
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, dx, dy, dw, dh);
      const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.7));
      const outUrl = URL.createObjectURL(blob);
      URL.revokeObjectURL(url);
      return { blob, url: outUrl };
    }

    // Path wanneer ImageBitmap beschikbaar is
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    const scale = Math.max(512 / bmp.width, 512 / bmp.height);
    const dw = Math.round(bmp.width * scale), dh = Math.round(bmp.height * scale);
    const dx = Math.round((512 - dw) / 2), dy = Math.round((512 - dh) / 2);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 512, 512);
    ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height, dx, dy, dw, dh);
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.7));
    const outUrl = URL.createObjectURL(blob);
    return { blob, url: outUrl };
  }

  function blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  function makePrompt() {
    const finish = finishVal.toLowerCase();
    const text = kleurVal;
    const hex = kleurHex;
    return [
      `Replace ONLY the window frames and doors with: ${text}${hex ? ` (${hex})` : ""}, ${finish}, deep uPVC style.`,
      "Match façade cladding if present.",
      "Do NOT alter walls/brickwork, roof, ground, people, vehicles, sky, or background.",
      "Keep lighting, geometry, reflections and perspective identical.",
    ].join(" ");
  }

  // ===== API =====
  async function generateOnce({ blob, prompt }: { blob: Blob; prompt: string }) {
    if (USE_FAKE_API) {
      // Simuleer 1 rondje genereren voor test/doel/demo
      await new Promise((r) => setTimeout(r, 1500));
      return MOCK_IMAGE_DATA_URL; // zou normaal een URL vanaf je backend zijn
    }

    const fd = new FormData();
    fd.append("prompt", prompt);
    fd.append("base", await blobToDataURL(blob)); // dataURL meesturen naar server

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 65000);

    try {
      const res = await fetch("/api/generate-sync", {
        method: "POST",
        body: fd,
        signal: controller.signal,
      });
      if (!res.ok) {
        const ttxt = await res.text().catch(() => "(geen tekst)");
        throw new Error(
          `Genereren mislukt (${res.status}). Probeer het opnieuw. Details: ${ttxt.slice(0, 200)}`
        );
      }
      const data = await res.json(); // { url }
      return data.url as string;
    } finally {
      clearTimeout(t);
    }
  }

  // ===== Events =====
  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setNaImage(null);
    setStatusText("");
    setProgress(0);

    if (!f) {
      setVoorImage(null);
      preparedBlobRef.current = null;
      setStep("idle");
      return;
    }

    if (!f.type.startsWith("image/")) {
      setStatusText("❌ Kies een afbeeldingsbestand.");
      setStep("error");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setStatusText("❌ Bestand is groter dan 10MB.");
      setStep("error");
      return;
    }

    setStatusText("Foto schalen…");
    setStep("scaling");
    try {
      const out = await scaleTo512(f);
      preparedBlobRef.current = out.blob;
      setVoorImage(out.url);
      setStatusText("Klaar om te genereren.");
      setStep("ready");
    } catch (err: any) {
      setStatusText("❌ Fout bij schalen van afbeelding.");
      setStep("error");
      console.error(err);
    }
  }

  async function onGenerate() {
    if (!preparedBlobRef.current) {
      setStatusText("📷 Kies eerst een foto.");
      return;
    }

    setIsGenerating(true);
    setNaImage(null);
    setStatusText("Bezig…");
    setProgress(10);
    setStep("generating");

    const start = Date.now();
    let iv: number | undefined;

    try {
      iv = window.setInterval(() => {
        const elapsed = Date.now() - start;
        const pct = Math.min(95, 10 + Math.floor((elapsed / 60000) * 85));
        setProgress(pct);
        setStatusText(
          `Genereren bij Reno loopt… ${pct}% • Dit duurt meestal 10–30 seconden`
        );
      }, 800);

      const url = await generateOnce({
        blob: preparedBlobRef.current,
        prompt: makePrompt(),
      });

      setNaImage(url);
      setStatusText("✅ Klaar! 100%");
      setProgress(100);
      setStep("done");
    } catch (err: any) {
      console.error(err);
      setStatusText("❌ Fout: " + (err?.message || "Onbekend"));
      setStep("error");
    } finally {
      if (iv) clearInterval(iv);
      setIsGenerating(false);
    }
  }

  function onReset() {
    setStatusText("");
    setProgress(0);
    if (voorImage) URL.revokeObjectURL(voorImage);
    if (naImage) URL.revokeObjectURL(naImage);
    setVoorImage(null);
    setNaImage(null);
    preparedBlobRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
    setStep("idle");
  }

  // ===== UI =====
  return (
    <>
      {/* Brand header in zelfde sfeer als achtergrond */}
      <header className="brandbar">
        <div className="brand">
          <img className="brand-logo" src="/rd-logo.png" alt="Renovatie Direct logo" />
          <div className="brand-text">
            <div className="brand-title">Renovatie Direct</div>
            <div className="brand-sub">Visualisatietool</div>
          </div>
        </div>
        <div className="brand-badge">Beta v1 {USE_FAKE_API ? "• Testmodus" : ""}</div>
      </header>

      <main className="container">
        <section className="hero">
          <div className="tile">
            <span className="pill">⚡ Snel & eenvoudig</span>
            <h1>
              Laat direct zien hoe het <em>straks</em> wordt
            </h1>
            <p className="lede">
              Upload een foto van de gevel, kies de kozijnkleur en genereer een realistische na-foto.
              Deuren en eventuele gevelbekleding worden automatisch meegenomen.
            </p>

            <div className="form">
              <div>
                <label htmlFor="file">Foto uploaden</label>
                <input id="file" ref={fileInputRef} onChange={onFileChange} type="file" accept="image/*" />
                <div className="hint">
                  {voorImage ? "Formaat: 512×512 JPEG (snel uploaden) • output 1024p" : ""}
                </div>
              </div>

              <div className="row">
                <div>
                  <label htmlFor="kleur">Kozijnkleur</label>
                  <select
                    id="kleur"
                    value={kleurVal}
                    onChange={(e) => {
                      setKleurVal(e.target.value);
                      setKleurHex((e.target.selectedOptions[0] as HTMLOptionElement).dataset.hex || "");
                    }}
                  >
                    <option data-hex="#383E42">Antraciet (RAL 7016) • verdiept profiel</option>
                    <option data-hex="#F5F6F7">Wit (RAL 9016) • verdiept profiel</option>
                    <option data-hex="#E7DCC8">Crème (RAL 9001) • verdiept profiel</option>
                    <option data-hex="#273C2C">Donkergroen (RAL 6009) • verdiept profiel</option>
                    <option data-hex="#6B4E3D">Bruin (houtlook) • verdiept profiel</option>
                    <option data-hex="#0A0A0A">Zwart (RAL 9005) • verdiept profiel</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="finish">Afwerking</label>
                  <select id="finish" value={finishVal} onChange={(e) => setFinishVal(e.target.value)}>
                    <option>Mat</option>
                    <option>Zijdeglans</option>
                    <option>Structuur</option>
                  </select>
                </div>
              </div>

              <div className="actions">
                <button className="btn" onClick={onGenerate} disabled={isGenerating || step !== "ready"}>
                  Genereer na-foto
                </button>
                <button className="btn secondary" type="button" onClick={onReset} disabled={isGenerating}>
                  Reset
                </button>
                <span className="hint status" aria-live="polite">{statusText}</span>
              </div>

              <div className="progress">
                <div className="bar" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>

          <div className="tile visuals">
            <div className="preview">
              <div className="shot">
                <h4>VOOR</h4>
                {voorImage ? (
                  <img src={voorImage} alt="Voorbeeld voor" />
                ) : (
                  <div className="placeholder">Nog geen foto</div>
                )}
              </div>
              <div className="shot">
                <h4>NA (AI)</h4>
                {naImage ? (
                  <img src={naImage} alt="Voorbeeld na" />
                ) : (
                  <div className="placeholder">Nog geen resultaat</div>
                )}
              </div>
            </div>
            <div className="dl">
              {naImage ? (
                <a href={naImage} download="na-foto.png" className="btn">
                  Download
                </a>
              ) : null}
              <span className="hint">{naImage ? "Tip: laat de klant inzoomen op details." : ""}</span>
            </div>
          </div>
        </section>

        <footer className="foot">© Renovatie Direct • Visualisatietool.</footer>
      </main>

      <style jsx>{`
        /* ====== Brand & thema ====== */
        :root{
          --brand-navy: #111c2b;
          --brand-green:#59b357;
          --brand-blue: #4fa3e3;
          --bg-cream:  #f7f3e3;
          --card:      #ffffff;
          --text:      #0e1320;
          --muted:     #647085;
          --line:      #e6e3d6;
        }

        *{ box-sizing:border-box }
        body{
          margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          color:var(--text); background:var(--bg-cream);
        }

        .brandbar{
          position: sticky; top:0; z-index:20;
          display:flex; align-items:center; justify-content:space-between; gap:14px;
          padding:14px 20px;
          background:var(--bg-cream);
          border-bottom: 1px solid var(--line);
        }
        .brand{ display:flex; align-items:center; gap:12px; }
        .brand-logo{ height:40px; width:auto; border-radius:8px }
        .brand-title{ font-weight:900; color:var(--brand-navy); line-height:1; letter-spacing:.2px; }
        .brand-sub{ font-size:12px; color:var(--muted); }
        .brand-badge{
          padding:6px 10px; border-radius:999px;
          border:1px solid var(--line); color:var(--muted); font-size:12px; background:#fff;
        }

        .container{ max-width:1100px; margin:0 auto; padding:16px 16px 28px; }
        .hero{ margin-top:18px; display:grid; grid-template-columns: 1.1fr .9fr; gap:20px; }
        @media (max-width: 980px){ .hero{ grid-template-columns:1fr; } }

        .tile{ background:var(--card); border:1px solid #eee9d8; border-radius: 20px; box-shadow: 0 10px 24px rgba(17,28,43,.06); padding:22px; }
        .tile h1{ margin:6px 0 10px; font-size:28px; line-height:1.2; color:var(--brand-navy); }
        .lede{ color:var(--muted); margin:0 0 12px; }

        .pill{ display:inline-flex; align-items:center; gap:10px; padding:9px 12px; border-radius:999px; background:#eef6ff; color:#114a7b; font-weight:600; font-size:12px; }
        .form{ display:grid; gap:14px; }
        .row{ display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
        @media (max-width: 720px){ .row{ grid-template-columns:1fr; } }
        label{ font-weight:700; font-size:14px; margin-bottom:6px; display:block; }
        input[type="file"], select{ width:100%; border:1px solid #ece7d6; border-radius:14px; background:#fff; padding:14px; font-size:15px; box-shadow: inset 0 1px 0 rgba(0,0,0,.02); }
        .hint{ color:var(--muted); font-size:13px; }

        .actions{ display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
        .btn{ appearance:none; border:0; cursor:pointer; font-weight:900; letter-spacing:.2px; padding:14px 18px; border-radius:16px; box-shadow: 0 6px 16px rgba(17,28,43,.12); background:linear-gradient(135deg, var(--brand-green), #3aa14b); color:#fff; transition:.2s transform ease, .2s box-shadow ease; }
        .btn:hover{ transform: translateY(-1px); box-shadow:0 10px 22px rgba(17,28,43,.18); }
        .btn[disabled]{ opacity:.6; cursor:not-allowed; }
        .btn.secondary{ background:#fff; color:var(--brand-navy); border:1px solid var(--line); box-shadow: 0 6px 16px rgba(17,28,43,.06); }
        .status{ min-height:22px; }

        .progress{ width:100%; height:8px; background:#efeada; border-radius:999px; overflow:hidden; margin-top:4px; }
        .progress .bar{ height:100%; width:0%; background:linear-gradient(90deg, var(--brand-green), #3aa14b); transition: width .4s ease; }

        .visuals{ background-image: radial-gradient(1200px 400px at 80% -20%, rgba(89,179,87,.08), transparent); }
        .preview{ display:grid; gap:12px; grid-template-columns: 1fr 1fr; }
        @media (max-width: 720px){ .preview{ grid-template-columns:1fr; } }
        .shot{ background:#f6f3e8; border:1px dashed #e6e1cf; border-radius: 16px; padding:10px; text-align:center; min-height:220px; display:flex; flex-direction:column; }
        .shot h4{ margin:4px 0 8px; font-size:13px; color:var(--muted); font-weight:800; letter-spacing:.2px; }
        .shot img{ display:block; max-width:100%; height:auto; border-radius:12px; margin:auto; object-fit: contain; }
        .placeholder{ color:#9aa3b2; font-size:14px; margin:auto; }

        .dl{ margin-top:10px; display:flex; gap:12px; align-items:center; }

        .foot{ color:var(--muted); font-size:12px; text-align:center; margin:18px 0 28px; }
      `}</style>
    </>
  );
}


/* ==========================================================
   === API-ROUTE VOOR PRODUCTIE (Next.js App Router) ===
   Plaats dit in: app/api/generate-sync/route.ts
   Vul RENO_API_URL en RENO_API_KEY als env vars in (Vercel).
   ========================================================== */

/*
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs"; // of "edge" als je upstream dat toelaat

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const prompt = String(form.get("prompt") || "");
    const base = String(form.get("base") || ""); // dataURL (image/jpeg)

    if (!prompt || !base) {
      return NextResponse.json({ error: "Missing prompt/base" }, { status: 400 });
    }

    const upstream = process.env.RENO_API_URL; // bv. https://api.renovatie.direct/generate
    const apiKey = process.env.RENO_API_KEY || "";

    if (!upstream) {
      return NextResponse.json({ error: "RENO_API_URL not set" }, { status: 500 });
    }

    // Stuur door naar je model/renderer
    const res = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ prompt, base }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return NextResponse.json({ error: t || `Upstream error ${res.status}` }, { status: 502 });
    }

    // Verwacht: { url: string }
    const data = await res.json();
    if (!data?.url) {
      return NextResponse.json({ error: "Upstream returned no url" }, { status: 502 });
    }
    return NextResponse.json({ url: data.url });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unknown" }, { status: 500 });
  }
}
*/

/* ==========================================================
   === ALTERNATIEF: Pages Router ===
   Plaats dit in: pages/api/generate-sync.ts
   ========================================================== */

/*
import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: { bodyParser: false }, // we lezen FormData, niet JSON
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const boundary = req.headers["content-type"]?.toString().split("boundary=")[1];
  if (!boundary) return res.status(400).json({ error: "Invalid multipart" });

  // Simpele multipart parse via web-standaard API is niet native in Node.
  // In productie: gebruik bv. busboy/formidable of stap over op App Router zoals hierboven.
  return res.status(400).json({ error: "Use App Router route.ts for multipart FormData" });
}
*/

/* ==========================================================
   === next.config.js (optioneel als je CDN-URL's toont) ===
   ========================================================== */

/*
// next.config.js
module.exports = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.jouw-domein.nl", // pas aan naar je eigen host
      },
    ],
  },
};
*/
