import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR Compliance: Shop Data Deletion
 * Triggered 48 hours after app uninstall
 * Must delete all shop data
 */
export async function action({ request }: ActionFunctionArgs) {
  // Verify this is a POST request
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { shop, payload, topic } = await authenticate.webhook(request);

    console.log("🗑️  GDPR: Shop redaction request received", {
      shop,
      topic,
      shopId: payload.shop_id,
      shopDomain: payload.shop_domain,
    });

    // Find store
    const store = await db.store.findUnique({
      where: { shopDomain: shop },
    });

    if (store) {
      let deletedMessages = 0;
      let deletedSessions = 0;
      let deletedFAQs = 0;

      // 1. Delete all chat messages
      const messagesResult = await db.chatMessage.deleteMany({
        where: { storeId: store.id },
      });
      deletedMessages = messagesResult.count;

      // 2. Delete all chat sessions
      const sessionsResult = await db.chatSession.deleteMany({
        where: { storeId: store.id },
      });
      deletedSessions = sessionsResult.count;

      // 3. Delete all FAQs
      const faqsResult = await db.fAQ.deleteMany({
        where: { storeId: store.id },
      });
      deletedFAQs = faqsResult.count;

      // 4. Delete store record
      await db.store.delete({
        where: { id: store.id },
      });

      console.log("✅ Shop data completely deleted:", {
        shop,
        storeId: store.id,
        messagesDeleted: deletedMessages,
        sessionsDeleted: deletedSessions,
        faqsDeleted: deletedFAQs,
      });
    }

    // Must respond with 200 status to acknowledge receipt
    return json({ success: true }, { status: 200 });
    
  } catch (error: any) {
    console.error("❌ Error redacting shop data:", error);
    
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

// Reject non-POST requests
export async function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}
