import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // verhoog server timeout (binnen je hosting-limieten)

function dataURLtoBuffer(dataUrl: string): { mime: string; buffer: Buffer } {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.split(";")[0].split(":")[1] || "image/jpeg";
  return { mime, buffer: Buffer.from(b64, "base64") };
}

// Fetch met abort-timeout zodat requests nooit “oneindig” hangen
function abortableFetch(input: RequestInfo | URL, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 110_000, ...rest } = init; // ~110s
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...rest, signal: controller.signal }).finally(() => clearTimeout(id));
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const prompt = String(form.get("prompt") || "");
    const base = String(form.get("base") || ""); // dataURL (image/jpeg)

    if (!prompt || !base) {
      return NextResponse.json({ error: "Missing prompt/base" }, { status: 400 });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY ontbreekt" }, { status: 500 });
    }
    if (!BLOB_TOKEN) {
      return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN ontbreekt" }, { status: 500 });
    }

    // 1) Multipart voor OpenAI Images Edits
    const boundary = "----rdtoolsv_" + Math.random().toString(36).slice(2);
    const CRLF = "\r\n";

    const { buffer: baseBuf, mime } = dataURLtoBuffer(base);

    const parts: Buffer[] = [];
    function pushField(name: string, value: string) {
      parts.push(Buffer.from(`--${boundary}${CRLF}`));
      parts.push(Buffer.from(`Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}`));
      parts.push(Buffer.from(value + CRLF));
    }
    function pushFile(name: string, filename: string, contentType: string, buf: Buffer) {
      parts.push(Buffer.from(`--${boundary}${CRLF}`));
      parts.push(Buffer.from(`Content-Disposition: form-data; name="${name}"; filename="${filename}"${CRLF}`));
      parts.push(Buffer.from(`Content-Type: ${contentType}${CRLF}${CRLF}`));
      parts.push(buf);
      parts.push(Buffer.from(CRLF));
    }

    pushField("prompt", prompt);
    pushFile("image", "base.jpg", mime, baseBuf);
    // Minimale instellingen
    pushField("n", "1");
    pushField("size", "1024x1024");
    pushField("response_format", "b64_json");

    parts.push(Buffer.from(`--${boundary}--${CRLF}`));
    const body = Buffer.concat(parts);

    // 2) OpenAI call met harde timeout (voorkomt eindeloos wachten)
    const oaiRes = await abortableFetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
      timeoutMs: 110_000,
    });

    if (!oaiRes.ok) {
      const t = await oaiRes.text().catch(() => "");
      return NextResponse.json({ error: t || `OpenAI error ${oaiRes.status}` }, { status: 502 });
    }

    const json = await oaiRes.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return NextResponse.json({ error: "OpenAI response zonder data" }, { status: 502 });

    const imgBuffer = Buffer.from(b64, "base64");

    // 3) Upload resultaat naar Vercel Blob (public)
    const key = `results/${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
    const putRes = await put(key, new Blob([imgBuffer]), {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
      token: BLOB_TOKEN,
    });

    return NextResponse.json({ url: putRes.url }, { status: 200 });
  } catch (err: any) {
    const msg = err?.name === "AbortError" ? "Timeout bij genereren (server)" : (err?.message || "Unknown error");
    const code = err?.name === "AbortError" ? 504 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
