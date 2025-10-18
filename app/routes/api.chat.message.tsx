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

    // Find or create store
    let store = await db.store.findUnique({
      where: { shopDomain: shop },
    });

    if (!store) {
      // Create store if it doesn't exist
      store = await db.store.create({
        data: {
          shopDomain: shop,
          shopName: shop,
          plan: "free",
          isActive: true,
        },
      });
    }

    // Get or create session
    let session;
    if (sessionId) {
      session = await db.chatSession.findUnique({
        where: { id: sessionId },
      });
    }

    if (!session) {
      // Generate a unique session token
      const sessionToken = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      session = await db.chatSession.create({
        data: {
          storeId: store.id,
          sessionToken: sessionToken,
          customerEmail: customer?.email || `guest_${Date.now()}@temp.com`,
          customerName: customer?.name || "Guest",
          status: "active",
          channel: "widget",
          language: "en",
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
    console.error("Error details:", error instanceof Error ? error.message : String(error));
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
    
    const response = json(
      { 
        error: "Failed to process message",
        reply: "I apologize, but I'm having trouble right now. Please try again or contact support.",
        debug: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined
      },
      { status: 500 }
    );
    return cors(request, response);
  }
}

export async function loader() {
  return json({ message: "Use POST method" }, { status: 405 });
}
