import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Unified Webhook Handler
 * Routes compliance webhooks to appropriate handlers
 */
export async function action({ request }: ActionFunctionArgs) {
  // Verify this is a POST request
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    // authenticate.webhook() automatically validates HMAC
    const { shop, payload, topic } = await authenticate.webhook(request);

    console.log("📨 Webhook received", {
      shop,
      topic,
      timestamp: new Date().toISOString(),
    });

    // Route to appropriate handler based on topic
    switch (topic) {
      case "CUSTOMERS_DATA_REQUEST":
        return await handleCustomersDataRequest(shop, payload);
      
      case "CUSTOMERS_REDACT":
        return await handleCustomersRedact(shop, payload);
      
      case "SHOP_REDACT":
        return await handleShopRedact(shop, payload);
      
      default:
        console.log(`⚠️ Unhandled webhook topic: ${topic}`);
        return json({ success: true, message: "Webhook received" }, { status: 200 });
    }
    
  } catch (error: any) {
    console.error("❌ Error processing webhook:", error);
    
    // If authentication failed (invalid HMAC), return 401
    if (error.message?.includes("HMAC") || error.message?.includes("Unauthorized")) {
      console.error("🔒 HMAC verification failed");
      return new Response("Unauthorized - Invalid HMAC", { status: 401 });
    }
    
    // For other errors, return 500
    return json(
      { success: false, error: "Internal server error" }, 
      { status: 500 }
    );
  }
}

// GDPR: Customer Data Request Handler
async function handleCustomersDataRequest(shop: string, payload: any) {
  console.log("📋 GDPR: Customer data request", {
    shop,
    customerId: payload.customer?.id,
    customerEmail: payload.customer?.email,
  });

  const store = await db.store.findUnique({
    where: { shopDomain: shop },
  });

  if (store) {
    const sessions = await db.chatSession.findMany({
      where: {
        storeId: store.id,
        customerEmail: payload.customer?.email,
      },
      include: {
        messages: true,
      },
    });

    const customerData = {
      shop,
      email: payload.customer?.email,
      totalSessions: sessions.length,
      totalMessages: sessions.reduce((acc, s) => acc + s.messages.length, 0),
      sessions: sessions.map(session => ({
        id: session.id,
        createdAt: session.createdAt,
        messages: session.messages.map(msg => ({
          role: msg.role,
          message: msg.message,
          createdAt: msg.createdAt,
        })),
      })),
    };

    console.log("✅ Customer data collected:", {
      email: payload.customer?.email,
      sessionsFound: customerData.totalSessions,
    });

    // TODO: Send data to customer via email
  }

  return json({ success: true }, { status: 200 });
}

// GDPR: Customer Data Deletion Handler
async function handleCustomersRedact(shop: string, payload: any) {
  console.log("🗑️ GDPR: Customer redaction", {
    shop,
    customerId: payload.customer?.id,
    customerEmail: payload.customer?.email,
  });

  const store = await db.store.findUnique({
    where: { shopDomain: shop },
  });

  if (store) {
    const sessions = await db.chatSession.findMany({
      where: {
        storeId: store.id,
        customerEmail: payload.customer?.email,
      },
    });

    let deletedSessions = 0;
    let deletedMessages = 0;

    for (const session of sessions) {
      const result = await db.chatMessage.deleteMany({
        where: { sessionId: session.id },
      });
      deletedMessages += result.count;

      await db.chatSession.delete({
        where: { id: session.id },
      });
      deletedSessions++;
    }

    console.log("✅ Customer data deleted:", {
      email: payload.customer?.email,
      sessionsDeleted: deletedSessions,
      messagesDeleted: deletedMessages,
    });
  }

  return json({ success: true }, { status: 200 });
}

// GDPR: Shop Data Deletion Handler
async function handleShopRedact(shop: string, payload: any) {
  console.log("🗑️ GDPR: Shop redaction", {
    shop,
    shopId: payload.shop_id,
  });

  const store = await db.store.findUnique({
    where: { shopDomain: shop },
  });

  if (store) {
    // Delete in correct order (foreign keys)
    
    // 1. Delete messages
    const messagesResult = await db.chatMessage.deleteMany({
      where: { 
        session: {
          storeId: store.id
        }
      },
    });

    // 2. Delete sessions
    const sessionsResult = await db.chatSession.deleteMany({
      where: { storeId: store.id },
    });

    // 3. Delete FAQs
    const faqsResult = await db.fAQ.deleteMany({
      where: { storeId: store.id },
    });

    // 4. Delete analytics
    await db.analytics.deleteMany({
      where: { storeId: store.id },
    });

    // 5. Delete automations
    await db.automation.deleteMany({
      where: { storeId: store.id },
    });

    // 6. Delete chat settings
    await db.chatSettings.deleteMany({
      where: { storeId: store.id },
    });

    // 7. Delete subscriptions
    await db.subscription.deleteMany({
      where: { storeId: store.id },
    });

    // 8. Delete store (last)
    await db.store.delete({
      where: { id: store.id },
    });

    console.log("✅ Shop data deleted:", {
      shop,
      messagesDeleted: messagesResult.count,
      sessionsDeleted: sessionsResult.count,
      faqsDeleted: faqsResult.count,
    });
  }

  return json({ success: true }, { status: 200 });
}

// Reject non-POST requests
export async function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}
