import { NextResponse } from "next/server";
import { conversationService } from "@/lib/conversation-service";

type TurnRequestBody = {
  text?: unknown;
  generationId?: unknown;
  delayedTool?: unknown;
  delayMs?: unknown;
  respectAbort?: unknown;
};

/**
 * POST /api/voice/turn
 * Generates an assistant response for an incoming user turn.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    let body: TurnRequestBody;
    try {
      body = (await req.json()) as TurnRequestBody;
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON payload" },
        { status: 400 }
      );
    }

    if (typeof body.text !== "string" || body.text.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "User turn text is required" },
        { status: 400 }
      );
    }

    if (body.text.length > 1000) {
      return NextResponse.json(
        { success: false, error: "Input text exceeds maximum length of 1000 characters" },
        { status: 400 }
      );
    }

    const generationId =
      typeof body.generationId === "number" ? body.generationId : 1;

    const delayedTool = Boolean(body.delayedTool);
    const delayMs = typeof body.delayMs === "number" ? body.delayMs : undefined;
    const respectAbort = Boolean(body.respectAbort);

    const responseText = await conversationService.generateResponse(
      body.text,
      {
        generationId,
        delayedTool,
        delayMs,
        respectAbort,
        signal: req.signal,
      }
    );

    return NextResponse.json({
      success: true,
      data: {
        responseText,
        generationId,
        timestamp: Date.now(),
      },
    });
  } catch (error) {
    console.error("[voice/turn] Error processing turn:", error);
    return NextResponse.json(
      { success: false, error: "Unable to process conversation turn" },
      { status: 500 }
    );
  }
}
