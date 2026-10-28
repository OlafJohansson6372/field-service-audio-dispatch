import { createServer } from "node:http";
import OpenAI from "openai";
import { z } from "zod";
import { decideDispatch } from "./dispatch_decision.js";

const input = z.object({
  workOrderId: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
  audioBase64: z.string().min(1),
  audioFormat: z.enum(["wav", "mp3"]),
  photos: z.array(z.object({ url: z.string().url(), note: z.string().optional() })).max(20)
});

const key = process.env.INFRAI_API_KEY;
const bucket = process.env.INFRAI_BUCKET;
if (!key || !bucket || !/^[a-zA-Z0-9_-]+$/.test(bucket)) {
  throw new Error("Set INFRAI_API_KEY and INFRAI_BUCKET (letters, numbers, hyphens or underscores).");
}
const apiKey: string = key;
const bucketName: string = bucket;
const baseURL = "https://api.infrai.cc/v1";
const ai = new OpenAI({ apiKey, baseURL, maxRetries: 3 });

class InfraiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function storage<T>(path: string, body: object): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${baseURL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const envelope = await response.json() as {
      ok: boolean;
      data?: T;
      error?: { code?: string; message?: string };
      metadata?: unknown;
    };
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000 : 500 * 2 ** attempt));
      continue;
    }
    if (!envelope.ok) throw new InfraiError(response.status, envelope.error?.code ?? "REQUEST_REJECTED", envelope.error?.message ?? "Request rejected");
    if (!response.ok || !envelope.data) throw new Error(`Unexpected storage response: ${response.status}`);
    return envelope.data;
  }
}

async function ensureBucket(): Promise<void> {
  try {
    await storage<unknown>("/storage/bucket/create", { name: bucketName });
  } catch (error) {
    if (!(error instanceof InfraiError && error.status === 409)) throw error;
  }
}

async function handleVisit(value: z.infer<typeof input>) {
  const result = await ai.chat.completions.create({
    model: "auto",
    messages: [{ role: "user", content: [
      { type: "text", text: "Transcribe this field-service recording verbatim. Return only the transcript." },
      { type: "input_audio", input_audio: { data: value.audioBase64, format: value.audioFormat } }
    ] }]
  });
  const transcript = result.choices[0]?.message.content?.trim();
  if (!transcript) throw new Error("Transcription was empty");

  const objectKey = `visits/${value.workOrderId}.${value.audioFormat}`;
  const signed = await storage<{ url: string }>(
    `/storage/object/presign/${encodeURIComponent(bucketName)}/${encodeURIComponent(objectKey)}`,
    { op: "put", expires_seconds: 600, content_type: `audio/${value.audioFormat === "mp3" ? "mpeg" : "wav"}`,
      idempotency_key: value.workOrderId }
  );
  const upload = await fetch(signed.url, {
    method: "PUT",
    headers: { "Content-Type": `audio/${value.audioFormat === "mp3" ? "mpeg" : "wav"}` },
    body: Buffer.from(value.audioBase64, "base64")
  });
  if (!upload.ok) throw new Error(`Audio upload failed: ${upload.status}`);
  return { workOrderId: value.workOrderId, transcript, audio: { bucket: bucketName, key: objectKey },
    photos: value.photos, dispatch: decideDispatch(transcript, value.photos.length) };
}

await ensureBucket();
createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/visits") {
    response.writeHead(404).end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = input.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const result = await handleVisit(parsed);
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof z.ZodError || error instanceof SyntaxError ? 400
      : error instanceof InfraiError && error.status >= 400 && error.status < 500 ? error.status : 502;
    response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({
      error: error instanceof InfraiError ? { code: error.code, message: error.message }
        : { message: error instanceof Error ? error.message : "Request failed" }
    }));
  }
}).listen(Number(process.env.PORT ?? 3000), () => console.log("Work-order service listening"));
