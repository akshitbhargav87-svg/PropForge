# PropForge

Turn a real object into a stylized game prop. Meta SAM 3.1 selects the object, Muse Image creates its art direction, and PropForge exports a transparent 2D sprite plus an optional textured 3D GLB.

## Start locally

1. Install Node.js 20.9 or newer.
2. Copy `.env.example` to `.env.local` and set `MODEL_API_KEY` to your Meta Model API key. `HUNYUAN_LOCAL_URL` defaults to the Windows Hunyuan launcher at `http://127.0.0.1:8080`.
3. In this folder, run `npm run dev`.
4. Open `http://localhost:3000`.

To generate the 3D prop inside PropForge, run the Hunyuan3D Windows launcher on the same PC. Start it and wait for the launcher to report that port 8080 is running. Keep it open while generating. PropForge calls its local Gradio API, then previews and downloads the returned GLB. If Texture Generation is enabled in Hunyuan, PropForge uses the textured result; if it is unavailable, PropForge falls back to Hunyuan's shape-only model. No paid 3D API is used. The launcher must be local to the machine running PropForge; a cloud-hosted PropForge deployment cannot reach a visitor's localhost.

The key stays in the Next.js server routes. Never add it to client-side code or commit `.env.local`.

## How the flow works

- The browser resizes the selected photo to a practical working size and lets the user tap an object.
- `/api/segment` sends a point prompt and photo to Meta SAM 3.1, decodes the returned mask, and sends the mask back to the browser.
- The browser clips the selected object into a temporary PNG.
- `/api/generate` sends the selected object and a style prompt to Muse Image, then returns a single isolated game-prop concept image.
- “Make transparent 2D sprite” uses Meta SAM 3.1 to segment the generated prop and exports it as an alpha PNG.
- “Create 3D prop” sends the Muse concept to the local Hunyuan3D Gradio API, previews the returned GLB in the browser, and provides a download. Textured output is used when the launcher's texture pipeline is available; otherwise it generates a shape-only GLB.

Muse Image returns an opaque image; SAM creates the transparent sprite mask. 3D generation runs on the user's local GPU through Hunyuan3D and does not use paid API credits. For 3D generation, PropForge sends the Muse concept to the local Hunyuan launcher and does not write it to disk.

## Models

- SAM 3.1 (`sam-3.1`) through `POST https://api.meta.ai/v1/responses`
- Muse Image (`muse-image-1.0`) through the Meta Model API image edit endpoint
- Local Tencent Hunyuan3D (through its Gradio API) for GLB output, textured when available
