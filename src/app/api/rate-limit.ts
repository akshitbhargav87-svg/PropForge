type RateWindow = { count: number; resetAt: number };

declare global {
  var propForgeRateWindows: Map<string, RateWindow> | undefined;
}

const windows = globalThis.propForgeRateWindows ??= new Map<string, RateWindow>();

export function rateLimit(request: Request, action: string, limit: number, windowMs: number) {
  const ip = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "local";
  const now = Date.now();
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }

  const key = `${action}:${ip}`;
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  if (current.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return Response.json(
      { error: `Please wait ${retryAfter} seconds before trying again.` },
      { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
    );
  }
  current.count += 1;
  return null;
}
