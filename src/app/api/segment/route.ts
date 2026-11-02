import OpenAI from "openai";
import { rateLimit } from "../rate-limit";
import {
  buildObjectPrompt,
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent,
} from "@meta-sam/parser";

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) return errorResponse("Add MODEL_API_KEY to .env.local to connect Meta models.", 503);
  const limited = rateLimit(request, "segment", 8, 60_000);
  if (limited) return limited;

  try {
    const body = await request.json();
    const imageDataUrl = body?.imageDataUrl;
    const width = Number(body?.width);
    const height = Number(body?.height);
    const x = Number(body?.point?.x);
    const y = Number(body?.point?.y);
    const rawNegativePoints = Array.isArray(body?.negativePoints) ? body.negativePoints.slice(0, 8) : [];

    if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
      return errorResponse("Choose a valid image first.", 400);
    }
    if (![width, height, x, y].every(Number.isFinite) || width < 1 || height < 1 || x < 0 || y < 0 || x >= width || y >= height) {
      return errorResponse("The selected point is outside the image.", 400);
    }
    if (width > 4096 || height > 4096) return errorResponse("Use an image under 4096 pixels on each side.", 413);
    const negativePoints: { x: number; y: number }[] = rawNegativePoints.map((point: { x?: unknown; y?: unknown }) => ({ x: Number(point?.x), y: Number(point?.y) }));
    if (negativePoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x >= width || point.y >= height)) {
      return errorResponse("A background hint fell outside the image.", 400);
    }

    const client = new OpenAI({ baseURL: "https://api.meta.ai/v1", apiKey });
    const prompt = buildObjectPrompt({
      size: { width, height },
      objects: [{
        id: 1,
        prompts: [{ points: [
          { x: Math.floor(x), y: Math.floor(y), label: "positive" as const },
          ...negativePoints.map((point) => ({ x: Math.floor(point.x), y: Math.floor(point.y), label: "negative" as const })),
        ] }],
      }],
    });

    const stream = await client.responses.create({
      model: "sam-3.1",
      input: [{
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: imageDataUrl, detail: "auto" },
        ],
      }],
      stream: true,
    });

    const parsed = parseImageStream(stream as AsyncIterable<ResponsesEvent>);
    const result = await parsed.finalResult;
    if (result.outcome.status !== "completed") return errorResponse("SAM could not finish that selection. Try another point.", 502);

    const [maskRecord] = recordsOfKind(result.records, "mask");
    if (!maskRecord) return errorResponse("No object found there. Tap the object itself and try again.", 422);

    const raster = decodeMaskToRaster(maskRecord.mask);
    return Response.json({
      mask: {
        width: maskRecord.mask.width,
        height: maskRecord.mask.height,
        raster: Buffer.from(raster).toString("base64"),
        bounds: maskRecord.bounds,
      },
    });
  } catch (error) {
    console.error("SAM segmentation failed", error);
    return errorResponse("Object selection failed. Check the connection and try again.", 502);
  }
}

