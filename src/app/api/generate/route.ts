import OpenAI, { toFile } from "openai";
import { rateLimit } from "../rate-limit";

const styles: Record<string, string> = {
  arcane: "an arcane fantasy RPG prop with antique gold surface filigree, deep indigo material accents, and a subtle glow contained on the surface",
  neon: "a cyberpunk game prop with controlled electric teal and magenta material accents, dark satin surfaces, and restrained edge lighting",
  folklore: "a warm folklore game prop with storybook ink details, rich earth pigments, and a clearly readable silhouette",
  pixel: "a polished 16-bit fantasy inventory prop with disciplined pixel clusters, a limited jewel-tone palette, and a clear silhouette",
};

export async function POST(request: Request) {
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) return Response.json({ error: "Add MODEL_API_KEY to .env.local to connect Meta models." }, { status: 503 });
  const limited = rateLimit(request, "concept", 3, 60_000);
  if (limited) return limited;

  try {
    const body = await request.json();
    const imageDataUrl = body?.imageDataUrl;
    const style = String(body?.style ?? "");
    const objectName = String(body?.objectName ?? "").trim().slice(0, 60);

    if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/png;base64,")) {
      return Response.json({ error: "The selected object image is not a valid PNG." }, { status: 400 });
    }
    if (!styles[style]) return Response.json({ error: "Choose one of the available art styles." }, { status: 400 });

    const imageBytes = Buffer.from(imageDataUrl.slice(imageDataUrl.indexOf(",") + 1), "base64");
    if (!imageBytes.length || imageBytes.length > 12 * 1024 * 1024) {
      return Response.json({ error: "The object image must be smaller than 12 MB." }, { status: 413 });
    }

    const client = new OpenAI({ baseURL: "https://api.meta.ai/v1", apiKey });
    const prompt = [
      "Create a production-minded 2D game prop concept based on the photographed real object.",
      objectName ? "The object is called " + objectName + "." : "",
      "Keep the object's original outer contour, proportions, and component layout recognizable. Apply the style to color, material, and small surface details only; do not inflate or reshape the object.",
      "Style direction: " + styles[style] + ".",
      "Show exactly one complete object, centered and isolated in a clear front three-quarter product view with only slight perspective distortion. The object should occupy about 78 percent of the image on its longest axis.",
      "Make a polished stylized game prop reference with a clean, evenly lit pale studio background, crisp outer edges, clearly separated planes, and a very small contact shadow directly beneath the object.",
      "Do not invent large protrusions, bulges, extra layers, handles, fins, bases, platforms, backplates, floor tiles, or background panels. No card, scene, extra props, floating debris, bloom, strong cast shadow, readable words, letters, logos, or numbers.",
    ].filter(Boolean).join(" ");

    const result = await client.images.edit({
      model: "muse-image-1.0",
      prompt,
      image: await toFile(imageBytes, "propforge-object.png", { type: "image/png" }),
      n: 1,
      output_format: "png",
      response_format: "b64_json",
    });

    const generated = result.data?.[0]?.b64_json;
    if (!generated) return Response.json({ error: "Muse Image returned no artwork. Try again." }, { status: 502 });
    return Response.json({ imageDataUrl: "data:image/png;base64," + generated });
  } catch (error) {
    console.error("Muse Image generation failed", error);
    return Response.json({ error: "Muse Image could not create the artifact. Check your Meta API access and try again." }, { status: 502 });
  }
}

