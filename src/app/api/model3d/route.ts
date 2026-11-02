import { Client, handle_file } from "@gradio/client";
import { rateLimit } from "../rate-limit";

export const maxDuration = 900;

const DEFAULT_HUNYUAN_URL = "http://127.0.0.1:8080";
const MAX_IMAGE_BYTES = 9 * 1024 * 1024;
const JOB_TTL_MS = 15 * 60 * 1000;

type GradioFile = {
  url?: string;
  path?: string;
  orig_name?: string;
  mime_type?: string;
};

type ModelJob = {
  status: "running" | "complete" | "error";
  message: string;
  percent: number | null;
  createdAt: number;
  modelBase64?: string;
  textured?: boolean;
  error?: string;
};

declare global {
  var propForgeModelJobs: Map<string, ModelJob> | undefined;
}

const jobs = globalThis.propForgeModelJobs ??= new Map<string, ModelJob>();

function unwrapGradioFile(value: unknown, depth = 0): GradioFile | null {
  if (depth > 5 || value == null) return null;
  if (typeof value === "string") return { url: value };
  if (Array.isArray(value)) {
    for (const item of value) {
      const file = unwrapGradioFile(item, depth + 1);
      if (file) return file;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.url === "string" || typeof record.path === "string") {
    return {
      url: typeof record.url === "string" ? record.url : undefined,
      path: typeof record.path === "string" ? record.path : undefined,
      orig_name: typeof record.orig_name === "string" ? record.orig_name : undefined,
      mime_type: typeof record.mime_type === "string" ? record.mime_type : undefined,
    };
  }
  for (const key of ["value", "data", "file", "files"]) {
    const nested = unwrapGradioFile(record[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function imageFromDataUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  return { bytes };
}

function messageForLocalError(error: unknown) {
  const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  if (/ECONNREFUSED|fetch failed|Failed to fetch|ENOTFOUND/i.test(message)) {
    return "Start the Hunyuan3D launcher and wait until it says the server is running on port 8080.";
  }
  return "Hunyuan3D could not create the model. Check its launcher window for the generation error, then try again.";
}

function updateJob(id: string, update: Partial<ModelJob>) {
  const job = jobs.get(id);
  if (job) jobs.set(id, { ...job, ...update });
}

async function generateModel(id: string, imageBytes: Buffer) {
  const baseUrl = (process.env.HUNYUAN_LOCAL_URL || DEFAULT_HUNYUAN_URL).replace(/\/$/, "");
  let client: Client | undefined;
  try {
    updateJob(id, { message: "Connecting to Hunyuan3D…", percent: null });
    client = await Client.connect(baseUrl);
    const api = await client.view_api();
    const endpoints = Object.keys(api.named_endpoints);
    const texturedEndpoint = endpoints.find((name) => name.endsWith("/generation_all"));
    const shapeEndpoint = endpoints.find((name) => name.endsWith("/shape_generation"));
    if (!texturedEndpoint && !shapeEndpoint) throw new Error("Hunyuan shape-generation endpoint was not found.");

    const seed = Math.floor(Math.random() * 10_000_000);
    const args = [
      null,
      handle_file(imageBytes),
      null,
      null,
      null,
      null,
      5,
      5.0,
      seed,
      256,
      true,
      8000,
      true,
    ];

    const run = async (endpoint: string) => {
      updateJob(id, {
        message: endpoint === texturedEndpoint ? "Generating shape and texture…" : "Generating the 3D shape…",
        percent: null,
      });
      const job = client!.submit(endpoint, args);
      let result: unknown[] | undefined;
      for await (const event of job) {
        if (event.type === "status") {
          if (event.stage === "error") throw new Error(typeof event.message === "string" ? event.message : "Hunyuan generation failed.");
          const progress = event.progress_data?.find((item) => typeof item.progress === "number");
          const percent = progress?.progress == null ? null : Math.round(progress.progress * 100);
          const message = progress?.desc || (event.stage === "pending"
            ? `Waiting for Hunyuan${typeof event.position === "number" ? ` (queue position ${event.position})` : ""}…`
            : event.stage === "generating" || event.stage === "streaming"
              ? "Generating 3D geometry and surface details…"
              : "Preparing your model…");
          updateJob(id, { message, percent });
        } else if (event.type === "data") {
          result = event.data;
        }
      }
      if (!result) throw new Error("Hunyuan finished without returning a model.");
      return result;
    };

    let outputs: unknown[] | undefined;
    let isTextured = false;
    if (texturedEndpoint) {
      try {
        outputs = await run(texturedEndpoint);
        isTextured = true;
      } catch (error) {
        if (!shapeEndpoint) throw error;
        console.warn("Hunyuan texture generation failed; retrying shape-only generation.", error);
        updateJob(id, { message: "Texture setup wasn’t available; generating the 3D shape…", percent: null });
      }
    }
    if (!outputs) {
      if (!shapeEndpoint) throw new Error("Hunyuan does not expose its shape-generation endpoint.");
      outputs = await run(shapeEndpoint);
    }

    let modelFile = unwrapGradioFile(outputs[isTextured ? 1 : 0]);
    if (!modelFile && isTextured && shapeEndpoint) {
      updateJob(id, { message: "Retrying as a shape-only model…", percent: null });
      outputs = await run(shapeEndpoint);
      modelFile = unwrapGradioFile(outputs[0]);
      isTextured = false;
    }
    if (!modelFile) throw new Error(isTextured ? "Hunyuan returned no textured mesh." : "Hunyuan returned no mesh.");

    const fileReference = modelFile.url || modelFile.path;
    if (!fileReference) throw new Error("Hunyuan returned a model in an unexpected format.");
    updateJob(id, { message: "Preparing the model preview…", percent: null });
    const modelUrl = new URL(fileReference, `${baseUrl}/`);
    const modelResponse = await fetch(modelUrl, { signal: AbortSignal.timeout(120_000) });
    if (!modelResponse.ok) throw new Error("Hunyuan finished, but PropForge could not retrieve its GLB.");

    const model = await modelResponse.arrayBuffer();
    if (model.byteLength < 12 || new TextDecoder().decode(model.slice(0, 4)) !== "glTF") {
      throw new Error("Hunyuan returned a model file that is not a GLB.");
    }
    updateJob(id, {
      status: "complete",
      message: "Your model is ready.",
      percent: 100,
      modelBase64: Buffer.from(model).toString("base64"),
      textured: isTextured,
    });
  } catch (error) {
    console.error("Local Hunyuan3D request failed", error);
    updateJob(id, { status: "error", error: messageForLocalError(error), message: "Generation failed." });
  } finally {
    client?.close();
  }
}

export async function POST(request: Request) {
  const limited = rateLimit(request, "model3d", 1, 60_000);
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  const image = imageFromDataUrl(body?.imageDataUrl);
  if (!image) {
    return Response.json({ error: "Create a Muse concept first. Its image must be smaller than 9 MB." }, { status: 400 });
  }

  for (const [id, job] of jobs) {
    if (Date.now() - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
  if ([...jobs.values()].some((job) => job.status === "running")) {
    return Response.json({ error: "Hunyuan is already generating a model. Wait for it to finish, then try again." }, { status: 409 });
  }

  const id = crypto.randomUUID();
  jobs.set(id, { status: "running", message: "Starting Hunyuan3D…", percent: null, createdAt: Date.now() });
  void generateModel(id, image.bytes);
  return Response.json({ jobId: id }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) return Response.json({ error: "A valid generation ID is required." }, { status: 400 });
  const job = jobs.get(jobId);
  if (!job || Date.now() - job.createdAt > JOB_TTL_MS) return Response.json({ error: "This generation expired. Start a new model generation." }, { status: 404 });
  return Response.json(job, { headers: { "Cache-Control": "no-store" } });
}
