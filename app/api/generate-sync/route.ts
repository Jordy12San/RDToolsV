import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

type Ok = { url: string };

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

function dataURLtoBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.split(";")[0].split(":")[1] || "image/jpeg";
  const bin = Buffer.from(b64, "base64");
  return new Blob([bin], { type: mime });
}

function randomId(){
  const s4 = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
  return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 60000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // @ts-ignore
    return await fetch(input, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function callOpenAI(fd: FormData) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetchWithTimeout("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
      body: fd,
      timeoutMs: 60000
    });
    if (res.ok) return res;
    if (res.status === 429 || res.status >= 500) {
      if (attempt === 1) continue;
    }
    return res;
  }
  throw new Error("Onbereikbaar pad");
}

export async function POST(req: Request) {
  try{
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY ontbreekt" }, { status: 500 });
    }
    if (!BLOB_TOKEN) {
      return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN ontbreekt in Environment Variables" }, { status: 500 });
    }

    const form = await req.formData();
    const prompt = String(form.get("prompt") || "");
    const base = String(form.get("base") || "");
    if (!base) return NextResponse.json({ error: "base (dataURL) ontbreekt" }, { status: 400 });

    const imageBlob = dataURLtoBlob(base);

    const fd = new FormData();
    fd.append("image", imageBlob, "base.jpg");
    fd.append("prompt", prompt);
    fd.append("model", "gpt-image-1");
    fd.append("n", "1");
    fd.append("size", "auto");

    const openaiRes = await callOpenAI(fd);
    const reqId = openaiRes.headers.get("x-request-id") || "";

    if (!openaiRes.ok) {
      const text = await openaiRes.text();
      return NextResponse.json({ error: `OpenAI error: ${openaiRes.status} ${text.slice(0,500)} ${reqId ? `(request-id ${reqId})` : ""}` }, { status: 500 });
    }

    const json: any = await openaiRes.json();

    let imgBuffer: ArrayBuffer | null = null;
    const url = json?.data?.[0]?.url;
    if (url) {
      const d = await fetchWithTimeout(url, { timeoutMs: 60000 });
      if (!d.ok) {
        const t = await d.text().catch(()=>"(geen tekst)");
        return NextResponse.json({ error: `Download van OpenAI image-url faalde: ${d.status} ${t.slice(0,300)}` }, { status: 500 });
      }
      imgBuffer = await d.arrayBuffer();
    } else {
      const b64 = json?.data?.[0]?.b64_json;
      if (!b64) {
        return NextResponse.json({ error: "Geen afbeelding ontvangen (url en b64_json ontbreken). Respons: "+JSON.stringify(json).slice(0,500) }, { status: 500 });
      }
      // @ts-ignore
      imgBuffer = Buffer.from(b64, "base64");
    }

    const jobId = randomId();
    const putRes = await put(`results/${jobId}.png`, new Blob([imgBuffer!]), {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
      token: BLOB_TOKEN,
    });

    const out: Ok = { url: putRes.url };
    return NextResponse.json(out, { status: 200 });
  }catch(e:any){
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
