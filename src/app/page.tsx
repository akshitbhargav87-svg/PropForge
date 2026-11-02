"use client";

import Image from "next/image";
import { createElement, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };
type Mask = { width: number; height: number; raster: string; bounds: Bounds };
type ArtStyle = "arcane" | "neon" | "folklore" | "pixel";
type OutputMode = "sprite" | "model";
type PreviewMaterial = {
  pbrMetallicRoughness: {
    setBaseColorFactor: (rgba: [number, number, number, number]) => void;
    setMetallicFactor: (value: number) => void;
    setRoughnessFactor: (value: number) => void;
  };
  setEmissiveFactor: (rgb: [number, number, number]) => void;
};
type ModelViewerElement = HTMLElement & { model?: { materials: PreviewMaterial[] } | null };

const styleMaterials: Record<ArtStyle, { base: [number, number, number, number]; emissive: [number, number, number]; metallic: number; roughness: number }> = {
  arcane: { base: [0.055, 0.075, 0.24, 1], emissive: [0.035, 0.018, 0.004], metallic: 0.56, roughness: 0.42 },
  neon: { base: [0.12, 0.68, 0.78, 1], emissive: [0.02, 0.16, 0.2], metallic: 0.58, roughness: 0.24 },
  folklore: { base: [0.58, 0.31, 0.18, 1], emissive: [0.08, 0.025, 0.008], metallic: 0.12, roughness: 0.72 },
  pixel: { base: [0.27, 0.38, 0.76, 1], emissive: [0.035, 0.045, 0.14], metallic: 0.4, roughness: 0.42 },
};

const styleOptions: { id: ArtStyle; title: string; note: string; icon: string }[] = [
  { id: "arcane", title: "Arcane relic", note: "Ancient magic · gold leaf", icon: "✳" },
  { id: "neon", title: "Neon future", note: "Electric city · chrome", icon: "ϟ" },
  { id: "folklore", title: "Wild folklore", note: "Storybook ink · earth", icon: "❋" },
  { id: "pixel", title: "Pixel quest", note: "16-bit · jewel tones", icon: "▦" },
];

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read that image."));
    image.src = src;
  });
}

function makeObjectCutout(photo: string, mask: Mask) {
  return loadImage(photo).then((image) => {
    const cropWidth = mask.bounds.right - mask.bounds.left;
    const cropHeight = mask.bounds.bottom - mask.bounds.top;
    const side = Math.ceil(Math.max(cropWidth, cropHeight) * 1.16);
    const offsetX = Math.round((side - cropWidth) / 2);
    const offsetY = Math.round((side - cropHeight) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable in this browser.");
    context.drawImage(image, mask.bounds.left, mask.bounds.top, cropWidth, cropHeight, offsetX, offsetY, cropWidth, cropHeight);

    const bytes = Uint8Array.from(atob(mask.raster), (character) => character.charCodeAt(0));
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = mask.width;
    maskCanvas.height = mask.height;
    const maskContext = maskCanvas.getContext("2d");
    if (!maskContext) throw new Error("Canvas is unavailable in this browser.");
    const maskPixels = maskContext.createImageData(mask.width, mask.height);
    for (let index = 0; index < bytes.length; index += 1) {
      const pixel = index * 4;
      maskPixels.data[pixel] = 255;
      maskPixels.data[pixel + 1] = 255;
      maskPixels.data[pixel + 2] = 255;
      maskPixels.data[pixel + 3] = bytes[index] ? 255 : 0;
    }
    maskContext.putImageData(maskPixels, 0, 0);
    context.globalCompositeOperation = "destination-in";
    context.drawImage(maskCanvas, offsetX, offsetY, cropWidth, cropHeight);
    return canvas.toDataURL("image/png");
  });
}

function SelectionOverlay({ mask, width, height }: { mask: Mask; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const bytes = Uint8Array.from(atob(mask.raster), (character) => character.charCodeAt(0));
    const bitmap = document.createElement("canvas");
    bitmap.width = mask.width;
    bitmap.height = mask.height;
    const bitmapContext = bitmap.getContext("2d");
    if (!bitmapContext) return;
    const pixels = bitmapContext.createImageData(mask.width, mask.height);
    for (let index = 0; index < bytes.length; index += 1) {
      const pixel = index * 4;
      pixels.data[pixel] = 203;
      pixels.data[pixel + 1] = 255;
      pixels.data[pixel + 2] = 105;
      pixels.data[pixel + 3] = bytes[index] ? 170 : 0;
    }
    bitmapContext.putImageData(pixels, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      bitmap,
      mask.bounds.left,
      mask.bounds.top,
      mask.bounds.right - mask.bounds.left,
      mask.bounds.bottom - mask.bounds.top,
    );
  }, [mask]);
  return <canvas ref={ref} className="selection-overlay" width={width} height={height} aria-hidden="true" />;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const modelViewerRef = useRef<ModelViewerElement | null>(null);
  const [photo, setPhoto] = useState("");
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [point, setPoint] = useState<Point | null>(null);
  const [mask, setMask] = useState<Mask | null>(null);
  const [objectImage, setObjectImage] = useState("");
  const [artifact, setArtifact] = useState("");
  const [sprite, setSprite] = useState("");
  const [outputMode, setOutputMode] = useState<OutputMode>("sprite");
  const [modelUrl, setModelUrl] = useState("");
  const [modelTextured, setModelTextured] = useState(false);
  const [modelProgress, setModelProgress] = useState({ message: "Connecting to Hunyuan3D…", percent: null as number | null });
  const [objectName, setObjectName] = useState("");
  const [style, setStyle] = useState<ArtStyle>("arcane");
  const [busy, setBusy] = useState<"segment" | "generate" | "sprite" | "model" | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const selectFile = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose a photo in JPG, PNG, or WebP format.");
      return;
    }
    setError("");
    setArtifact("");
    setSprite("");
    setModelUrl("");
    setModelTextured(false);
    setMask(null);
    setObjectImage("");
    setPoint(null);
    const source = URL.createObjectURL(file);
    loadImage(source).then((image) => {
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable in this browser.");
      context.drawImage(image, 0, 0, width, height);
      setDimensions({ width, height });
      setPhoto(canvas.toDataURL("image/jpeg", 0.9));
      URL.revokeObjectURL(source);
    }).catch(() => {
      setError("I couldn’t open that photo. Try another image.");
      URL.revokeObjectURL(source);
    });
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => selectFile(event.target.files?.[0]);
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files?.[0]);
  };

  useEffect(() => {
    if (modelUrl) void import("@google/model-viewer");
  }, [modelUrl]);

  useEffect(() => {
    if (!modelUrl || modelTextured) return;
    const viewer = modelViewerRef.current;
    if (!viewer) return;
    const applyStyleMaterial = () => {
      const material = styleMaterials[style];
      for (const part of viewer.model?.materials ?? []) {
        part.pbrMetallicRoughness.setBaseColorFactor(material.base);
        part.pbrMetallicRoughness.setMetallicFactor(material.metallic);
        part.pbrMetallicRoughness.setRoughnessFactor(material.roughness);
        part.setEmissiveFactor(material.emissive);
      }
    };
    viewer.addEventListener("load", applyStyleMaterial);
    if (viewer.model) applyStyleMaterial();
    return () => viewer.removeEventListener("load", applyStyleMaterial);
  }, [modelUrl, modelTextured, style]);

  useEffect(() => {
    if (!modelUrl.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(modelUrl);
  }, [modelUrl]);

  const choosePoint = (clientX: number, clientY: number, element: HTMLElement) => {
    if (!photo || busy) return;
    const rect = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(dimensions.width - 1, Math.round(((clientX - rect.left) / rect.width) * dimensions.width)));
    const y = Math.max(0, Math.min(dimensions.height - 1, Math.round(((clientY - rect.top) / rect.height) * dimensions.height)));
    setPoint({ x, y });
    setMask(null);
    setObjectImage("");
    setArtifact("");
    setSprite("");
    setModelUrl("");
    setModelTextured(false);
    setError("");
  };

  const segmentObject = async () => {
    if (!photo || !point) return;
    setBusy("segment");
    setError("");
    try {
      const response = await fetch("/api/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: photo, width: dimensions.width, height: dimensions.height, point }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Object selection failed.");
      const selectedMask = result.mask as Mask;
      setMask(selectedMask);
      setObjectImage(await makeObjectCutout(photo, selectedMask));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Object selection failed. Try another point.");
    } finally {
      setBusy(null);
    }
  };

  const forgeArtifact = async () => {
    if (!objectImage) return;
    setBusy("generate");
    setError("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: objectImage, style, objectName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Muse Image could not make the artifact.");
      setArtifact(result.imageDataUrl);
      setSprite("");
      setModelUrl("");
      setModelTextured(false);
      setOutputMode("sprite");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Muse Image could not make the artifact. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const makeSprite = async () => {
    if (!artifact) return;
    setBusy("sprite");
    setError("");
    try {
      const image = await loadImage(artifact);
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable in this browser.");
      context.drawImage(image, 0, 0, width, height);
      const segmentationImage = canvas.toDataURL("image/png");
      const inset = Math.max(1, Math.floor(Math.min(width, height) * 0.015));
      const negativePoints = [
        { x: inset, y: inset },
        { x: width - 1 - inset, y: inset },
        { x: inset, y: height - 1 - inset },
        { x: width - 1 - inset, y: height - 1 - inset },
      ];
      const response = await fetch("/api/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: segmentationImage, width, height, point: { x: Math.floor(width / 2), y: Math.floor(height / 2) }, negativePoints }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not remove the background.");
      setSprite(await makeObjectCutout(segmentationImage, result.mask as Mask));
      setOutputMode("sprite");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not make the transparent sprite. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const makeModel = async () => {
    if (!artifact) return;
    setBusy("model");
    setError("");
    setModelUrl("");
    setModelTextured(false);
    setModelProgress({ message: "Connecting to Hunyuan3D…", percent: null });
    setOutputMode("model");
    try {
      const response = await fetch("/api/model3d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: artifact }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Could not create the 3D model.");
      }
      const started = await response.json() as { jobId?: string; error?: string };
      if (!started.jobId) throw new Error(started.error || "Could not start the 3D generation.");
      let completed: { modelBase64: string; textured: boolean } | null = null;
      while (true) {
        const statusResponse = await fetch(`/api/model3d?jobId=${encodeURIComponent(started.jobId)}`, { cache: "no-store" });
        const status = await statusResponse.json() as { status?: string; message?: string; percent?: number | null; error?: string; modelBase64?: string; textured?: boolean };
        if (!statusResponse.ok) throw new Error(status.error || "Could not read the 3D generation status.");
        setModelProgress({ message: status.message || "Generating your model…", percent: status.percent ?? null });
        if (status.status === "error") throw new Error(status.error || "Hunyuan could not create the model.");
        if (status.status === "complete" && status.modelBase64) {
          completed = { modelBase64: status.modelBase64, textured: Boolean(status.textured) };
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
      if (!completed) throw new Error("Hunyuan ended the generation without returning a model. Try again.");
      const modelBytes = Uint8Array.from(atob(completed.modelBase64), (character) => character.charCodeAt(0));
      const modelBlob = new Blob([modelBytes], { type: "model/gltf-binary" });
      if (!modelBlob.size) throw new Error("Hunyuan3D returned an empty model. Try again.");
      setModelTextured(completed.textured);
      setModelUrl(URL.createObjectURL(modelBlob));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the local 3D model. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleStageKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      choosePoint(rect.left + rect.width / 2, rect.top + rect.height / 2, event.currentTarget);
    }
  };

  const clearProject = () => {
    setPhoto("");
    setDimensions({ width: 0, height: 0 });
    setPoint(null);
    setMask(null);
    setObjectImage("");
    setArtifact("");
    setSprite("");
    setModelUrl("");
    setModelTextured(false);
    setOutputMode("sprite");
    setObjectName("");
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const currentStep = artifact ? 3 : objectImage ? 3 : photo ? 2 : 1;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="PropForge home">
          <span className="brand-mark"><span /></span>
          <span>propforge<span className="brand-period">.</span></span>
        </a>
        <div className="topbar-right">
          <span className="model-pill"><span className="status-dot" /> MADE WITH MUSE IMAGE</span>
          <button className="reset-button" onClick={clearProject}>Start over <span aria-hidden="true">↗</span></button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><span className="eyebrow-line" /> A LITTLE MAGIC FOR EVERYDAY THINGS</div>
        <h1>Turn real things<br /><em>into game props.</em></h1>
        <p className="hero-copy">Turn a real object into a stylized 2D sprite and a 3D game prop.</p>
      </section>

      <section className="workbench" aria-label="Artifact creation workspace">
        <div className="controls-panel">
          <div className="step-list" aria-label="Creation steps">
            <div className={currentStep === 1 ? "step active" : "step done"}><span className="step-number">{photo ? "✓" : "01"}</span><span>Bring an object</span></div>
            <div className={currentStep === 2 ? "step active" : objectImage ? "step done" : "step"}><span className="step-number">{objectImage ? "✓" : "02"}</span><span>Choose a style</span></div>
            <div className={artifact ? "step done" : "step"}><span className="step-number">03</span><span>Export game asset</span></div>
          </div>

          <div className="form-block">
            <div className="form-heading"><span className="micro-label">01 / THE OBJECT</span><span className="quiet-label">A photo from your world</span></div>
            {!photo ? (
              <div
                className={dragging ? "upload-zone dragging" : "upload-zone"}
                onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
                aria-label="Upload an object photo"
              >
                <input ref={inputRef} className="file-input" type="file" accept="image/*" onChange={handleInput} />
                <span className="upload-icon" aria-hidden="true">＋</span>
                <span className="upload-title">Drop a photo here</span>
                <span className="upload-subtitle">or <span className="text-link">browse files</span></span>
                <span className="upload-footnote">JPG, PNG or WebP · under 12 MB</span>
              </div>
            ) : (
              <div className="photo-stage-wrap">
                <div
                  className="photo-stage"
                  onClick={(event) => choosePoint(event.clientX, event.clientY, event.currentTarget)}
                  onKeyDown={handleStageKey}
                  role="button"
                  tabIndex={0}
                  aria-label="Tap the object you want to transform"
                >
                  <Image src={photo} alt="Uploaded object" width={dimensions.width} height={dimensions.height} unoptimized />
                  {mask && <SelectionOverlay key={mask.raster.slice(0, 18)} mask={mask} width={dimensions.width} height={dimensions.height} />}
                  {point && !mask && <span className="tap-marker" style={{ left: (point.x / dimensions.width * 100) + "%", top: (point.y / dimensions.height * 100) + "%" }} />}
                  {!mask && <span className="stage-hint">{point ? "Target selected" : "Tap your object"}</span>}
                  {mask && <span className="selected-tag"><span /> Object selected</span>}
                </div>
                <div className="photo-meta"><span>{dimensions.width} × {dimensions.height}</span><button onClick={clearProject}>Change photo</button></div>
              </div>
            )}
          </div>

          {photo && !objectImage && (
            <button className="primary-button" onClick={segmentObject} disabled={!point || Boolean(busy)}>
              {busy === "segment" ? <><span className="spinner" /> Finding your object…</> : <>Select this object <span>↗</span></>}
            </button>
          )}

          {objectImage && (
            <>
              <div className="form-block style-block">
                <div className="form-heading"><span className="micro-label">02 / ITS GAME LOOK</span><span className="quiet-label">Pick a visual style</span></div>
                <div className="style-grid">
                  {styleOptions.map((option) => (
                    <button key={option.id} className={style === option.id ? "style-option selected" : "style-option"} onClick={() => setStyle(option.id)}>
                      <span className="style-icon">{option.icon}</span>
                      <span className="style-copy"><strong>{option.title}</strong><small>{option.note}</small></span>
                      <span className="radio-dot" />
                    </button>
                  ))}
                </div>
                <label className="name-label" htmlFor="object-name">Give it a name <span>optional</span></label>
                <input id="object-name" className="name-input" value={objectName} onChange={(event) => setObjectName(event.target.value)} placeholder="e.g. The Last Teacup" maxLength={60} />
              </div>
              <button className="primary-button forge-button" onClick={forgeArtifact} disabled={Boolean(busy)}>
                {busy === "generate" ? <><span className="spinner" /> Designing your game prop…</> : <>Create my game prop <span>✦</span></>}
              </button>
              {artifact && (
                <div className="output-actions">
                  <button className="secondary-button" onClick={makeSprite} disabled={Boolean(busy) || Boolean(sprite)}>
                    {busy === "sprite" ? <><span className="spinner" /> Cutting out sprite…</> : sprite ? "✓ Transparent sprite ready" : "Make transparent 2D sprite"}
                  </button>
                  <button className="secondary-button model-action" onClick={makeModel} disabled={Boolean(busy)}>
                    {busy === "model" ? <><span className="spinner" /> Forging 3D prop…</> : modelUrl ? "Regenerate 3D prop · GLB" : "Create 3D prop · GLB"}
                  </button>
                  <p className="provider-note">Generated by Hunyuan3D on your PC. Enable Texture Generation in its launcher for textured output.</p>
                </div>
              )}
            </>
          )}

          {error && <div className="error-note" role="alert"><span>!</span>{error}</div>}
          <p className="privacy-note"><span aria-hidden="true">◇</span> Your photo is used only to create your game asset.</p>
        </div>

        <div className="preview-panel">
          <div className="preview-heading">
            <div><span className="micro-label">THE FORGE</span><h2>Your game asset<span>.</span></h2></div>
            {artifact && <span className="ready-badge"><span /> {modelUrl && outputMode === "model" ? modelTextured ? "TEXTURED 3D READY" : "3D SHAPE READY" : "CONCEPT READY"}</span>}
          </div>
          {artifact && <div className="output-tabs" role="tablist" aria-label="Asset output">
            <button role="tab" aria-selected={outputMode === "sprite"} className={outputMode === "sprite" ? "output-tab active" : "output-tab"} onClick={() => setOutputMode("sprite")}>2D sprite</button>
            <button role="tab" aria-selected={outputMode === "model"} className={outputMode === "model" ? "output-tab active" : "output-tab"} onClick={() => setOutputMode("model")}>3D model</button>
          </div>}
          <div className={artifact ? "artifact-stage has-artifact" : "artifact-stage"}>
            {artifact && outputMode === "model" && modelUrl ? (
              <div className="model-result">
                {createElement("model-viewer", { ref: modelViewerRef, src: modelUrl, "camera-controls": true, "auto-rotate": true, "shadow-intensity": "1", "environment-image": "neutral", "camera-orbit": "24deg 72deg 130%", "field-of-view": "32deg", alt: "Generated 3D game prop", style: { width: "100%", height: "100%", minHeight: "420px" } })}
                <span className="model-hint">Drag to rotate · scroll to zoom</span>
              </div>
            ) : artifact && outputMode === "model" && busy === "model" ? (
              <div className="loading-artifact model-loading"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="loading-spark">◇</div><span>{modelProgress.message}</span><div className="generation-progress" role="progressbar" aria-label="3D model generation" aria-valuemin={0} aria-valuemax={100} aria-valuenow={modelProgress.percent ?? undefined}><div className={modelProgress.percent == null ? "generation-progress-fill indeterminate" : "generation-progress-fill"} style={modelProgress.percent == null ? undefined : { width: `${Math.max(0, Math.min(100, modelProgress.percent))}%` }} /></div>{modelProgress.percent != null && <small>{modelProgress.percent}%</small>}</div>
            ) : artifact && outputMode === "model" ? (
              <div className="empty-artifact"><div className="empty-illustration"><div className="empty-card"><div className="card-orbit"><span>◇</span></div></div></div><span className="empty-title">Your 3D prop will appear here.</span><span className="empty-copy">Start Hunyuan3D locally, then generate a GLB. Texture is included when enabled.</span></div>
            ) : artifact ? (
              <div className="artifact-result">
                <Image src={sprite || artifact} alt={sprite ? "Transparent 2D game sprite" : "Stylized game prop concept"} width={1024} height={1024} unoptimized priority />
                {!sprite && <div className="artifact-stamp">CONCEPT IMAGE · MAKE SPRITE FOR ALPHA PNG</div>}
              </div>
            ) : busy === "generate" ? (
              <div className="loading-artifact"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="loading-spark">✦</div><span>Something legendary<br />is taking shape</span></div>
            ) : (
              <div className="empty-artifact">
                <div className="empty-illustration">
                  <div className="star star-a">✦</div><div className="star star-b">✧</div><div className="star star-c">·</div>
                  <div className="empty-card"><div className="card-orbit"><span>✦</span></div><div className="card-rune">✳</div><div className="card-lines"><i /><i /><i /></div></div>
                  <div className="spark-trail">✧ ─ ─ ✦</div>
                </div>
                <span className="empty-title">A game prop starts with a real thing.</span>
                <span className="empty-copy">Create a concept, then export a sprite or 3D model.</span>
              </div>
            )}
          </div>
          <div className="preview-footer">
            <div className="footer-left"><span className="footer-spark">✦</span><span>{artifact ? outputMode === "model" ? modelUrl ? modelTextured ? "Textured GLB generated locally by Hunyuan3D." : "Hunyuan3D shape generated locally; texture generation is off." : "A 3D interpretation of your concept." : sprite ? "Transparent, centered, and ready for your game." : "Muse concept. Remove the background to export a sprite." : "Made from something you already own."}</span></div>
            {artifact && outputMode === "sprite" && sprite && <a className="download-button" href={sprite} download="propforge-sprite.png">Download 2D PNG <span>↓</span></a>}
            {artifact && outputMode === "sprite" && !sprite && <button className="download-button download-trigger" onClick={makeSprite} disabled={Boolean(busy)}>Make sprite PNG <span>↓</span></button>}
            {artifact && outputMode === "model" && modelUrl && <a className="download-button" href={modelUrl} download="propforge-model.glb">Download GLB <span>↓</span></a>}
            {!artifact && <span className="output-note">TRANSPARENT PNG · GLB</span>}
          </div>
        </div>
      </section>

      <footer className="site-footer"><span>PROP<span className="footer-join">✦</span>FORGE</span><span>A creative experiment with Meta Muse Image</span><span>2026</span></footer>
    </main>
  );
}



