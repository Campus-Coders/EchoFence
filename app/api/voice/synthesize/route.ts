import { NextResponse } from "next/server";
import { rimeProviderAdapter } from "@/lib/rime-provider";
import { generationAwareSynthesis } from "@/lib/generation-aware-synthesis";

type SynthesizeRequestBody = {
  text?: unknown;
  voice?: unknown;
  model?: unknown;
  generationId?: unknown;
  requestId?: unknown;
  authorize?: unknown;
  format?: unknown;
};

/**
 * POST /api/voice/synthesize
 * Secure synthesis proxy backed by RimeProviderAdapter and GenerationAwareSynthesis.
 * Browser receives audio payload without accessing credentials.
 * Preserves generationId and requestId traceability.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    let body: SynthesizeRequestBody;
    try {
      body = (await req.json()) as SynthesizeRequestBody;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Text is required for speech synthesis" },
        { status: 400 }
      );
    }

    if (body.text.length > 2000) {
      return NextResponse.json(
        { success: false, error: "Text exceeds maximum synthesis limit of 2000 characters" },
        { status: 400 }
      );
    }

    const generationId =
      typeof body.generationId === "number" && !isNaN(body.generationId)
        ? body.generationId
        : 1;

    const requestId =
      typeof body.requestId === "string" && body.requestId.trim().length > 0
        ? body.requestId.trim()
        : `synth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const voice = typeof body.voice === "string" ? body.voice : undefined;
    const model = typeof body.model === "string" ? body.model : undefined;

    const acceptHeader = req.headers.get("accept") || "";
    const wantsAudio =
      acceptHeader.includes("audio/") ||
      body.format === "binary" ||
      body.format === "audio";
    const wantsJson = body.format === "json" || !wantsAudio;

    // Optional Step 12 Generation-Aware Authorization Mode
    if (Boolean(body.authorize)) {
      const outcome = await generationAwareSynthesis.synthesizeForGeneration(
        generationId,
        body.text,
        {
          requestId,
          voice,
          model,
        }
      );

      if (outcome.kind === "authorized") {
        const contentType = outcome.result.contentType || "audio/mpeg";
        const audioSource =
          outcome.result.audioSource ||
          (rimeProviderAdapter.getMode() === "real"
            ? "REAL_RIME_AUDIO"
            : "FALLBACK_SYNTHETIC_AUDIO");

        if (!wantsJson) {
          return new NextResponse(outcome.result.audioBuffer, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(outcome.result.audioBuffer.byteLength),
              "X-Generation-Id": String(outcome.result.generationId),
              "X-Request-Id": outcome.result.requestId,
              "X-Audio-Available": "true",
              "X-Audio-Source": audioSource,
              "X-Provider": outcome.result.provider || "Rime",
              "X-Model": outcome.result.model || "",
              "X-Voice": outcome.result.voice || "",
              "X-Authorized": "true",
              "X-Duration-Ms": String(outcome.result.providerLatencyMs ?? 0),
              "Cache-Control": "no-store, no-cache, must-revalidate",
            },
          });
        }

        const base64Audio = Buffer.from(outcome.result.audioBuffer).toString("base64");
        return NextResponse.json({
          success: true,
          data: {
            authorized: true,
            audioAvailable: true,
            audioBase64: base64Audio,
            audioSource,
            contentType,
            provider: outcome.result.provider,
            model: outcome.result.model,
            voice: outcome.result.voice,
            durationMs: outcome.result.providerLatencyMs,
            generationId: outcome.result.generationId,
            requestId: outcome.result.requestId,
            status: "completed",
          },
        });
      }

      if (outcome.kind === "stale") {
        return NextResponse.json(
          {
            success: true,
            data: {
              authorized: false,
              audioAvailable: false,
              stale: true,
              reason: outcome.reason,
              generationId: outcome.generationId,
              requestId: outcome.requestId,
              activeGeneration: outcome.activeGeneration,
              status: "stale",
            },
          },
          {
            status: 200,
            headers: {
              "X-Generation-Id": String(outcome.generationId),
              "X-Audio-Available": "false",
              "X-Stale": "true",
            },
          }
        );
      }

      if (outcome.kind === "cancelled") {
        return NextResponse.json({
          success: false,
          error: outcome.reason,
          generationId: outcome.generationId,
          requestId: outcome.requestId,
          status: "cancelled",
        });
      }

      return NextResponse.json(
        {
          success: false,
          error: outcome.error,
          errorCode: outcome.errorCode || "PROVIDER_ERROR",
          generationId: outcome.generationId,
          requestId: outcome.requestId,
          status: "failed",
        },
        { status: 500 }
      );
    }

    // Step 11 Provider Boundary Proxy (Standard Mode)
    const result = await rimeProviderAdapter.synthesize({
      generationId,
      requestId,
      text: body.text,
      startedAt: Date.now(),
      voice,
      model,
    });

    if (result.status === "completed" && result.audioBuffer) {
      const contentType = result.contentType || "audio/mpeg";
      const audioSource =
        result.audioSource ||
        (rimeProviderAdapter.getMode() === "real"
          ? "REAL_RIME_AUDIO"
          : "FALLBACK_SYNTHETIC_AUDIO");

      if (!wantsJson) {
        return new NextResponse(result.audioBuffer, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(result.audioBuffer.byteLength),
            "X-Generation-Id": String(result.generationId),
            "X-Request-Id": result.requestId,
            "X-Audio-Available": "true",
            "X-Audio-Source": audioSource,
            "X-Provider": result.provider || "Rime",
            "X-Model": result.model || "",
            "X-Voice": result.voice || "",
            "X-Duration-Ms": String(result.latencyMs ?? 0),
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        });
      }

      const base64Audio = Buffer.from(result.audioBuffer).toString("base64");

      return NextResponse.json({
        success: true,
        data: {
          audioAvailable: true,
          audioBase64: base64Audio,
          audioSource,
          contentType,
          provider: result.provider || "Rime",
          model: result.model,
          voice: result.voice,
          durationMs: result.latencyMs ?? 0,
          generationId: result.generationId,
          requestId: result.requestId,
          status: result.status,
        },
      });
    }

    if (result.errorCode === "NOT_CONFIGURED") {
      return NextResponse.json(
        {
          success: true,
          data: {
            audioAvailable: false,
            provider: "Rime",
            generationId: result.generationId,
            requestId: result.requestId,
            status: result.status,
            errorCode: result.errorCode,
            reason: result.error || "Provider API key is not configured. Live audio synthesis unavailable.",
          },
        },
        {
          status: 200,
          headers: {
            "X-Generation-Id": String(result.generationId),
            "X-Audio-Available": "false",
            "X-Error-Code": result.errorCode || "NOT_CONFIGURED",
          },
        }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: result.error || "Speech synthesis failed",
        errorCode: result.errorCode || "PROVIDER_ERROR",
        generationId: result.generationId,
        requestId: result.requestId,
        status: result.status,
      },
      { status: result.status === "cancelled" ? 200 : 500 }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[voice/synthesize] Synthesis failure:", msg);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to synthesize speech",
      },
      { status: 500 }
    );
  }
}

