import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { cors } from "../utils/cors.server";
import db from "../db.server";
import { generateAIResponse, analyzeSentiment } from "../services/ai.server";

export async function action({ request }: ActionFunctionArgs) {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    const { message, shop, customer, sessionId } = await request.json();

    if (!message || !shop) {
      return json({ error: "Missing required fields" }, { status: 400 });
    }

    // Find store
    const store = await db.store.findUnique({
      where: { shopDomain: shop },
    });

    if (!store) {
      return json({ error: "Store not found" }, { status: 404 });
    }

    // Get or create session
    let session;
    if (sessionId) {
      session = await db.chatSession.findUnique({
        where: { id: sessionId },
      });
    }

    if (!session) {
      session = await db.chatSession.create({
        data: {
          storeId: store.id,
          customerEmail: customer?.email,
          customerName: customer?.name,
          status: "active",
        },
      });
    }

    // Save customer message
    await db.chatMessage.create({
      data: {
        sessionId: session.id,
        storeId: store.id,
        message: message,
        role: "user",
      },
    });

    // Get FAQs for context
    const faqs = await db.fAQ.findMany({
      where: {
        storeId: store.id,
        isActive: true,
      },
      take: 10,
    });

    // Generate AI response using Gemini
    const aiResponse = await generateAIResponse(message, {
      shop: shop,
      customer: customer,
      faqs: faqs,
    });

    // Analyze sentiment
    const sentiment = await analyzeSentiment(message);

    // Save AI response
    await db.chatMessage.create({
      data: {
        sessionId: session.id,
        storeId: store.id,
        message: aiResponse,
        role: "assistant",
      },
    });

    // Update session
    await db.chatSession.update({
      where: { id: session.id },
      data: {
        lastMessageAt: new Date(),
      },
    });

    const response = json({
      reply: aiResponse,
      sessionId: session.id,
      sentiment: sentiment,
    });

    return cors(request, response);
  } catch (error) {
    console.error("Chat API error:", error);
    const response = json(
      { 
        error: "Failed to process message",
        reply: "I apologize, but I'm having trouble right now. Please try again or contact support."
      },
      { status: 500 }
    );
    return cors(request, response);
  }
}

export async function loader() {
  return json({ message: "Use POST method" }, { status: 405 });
}
