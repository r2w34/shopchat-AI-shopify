import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR Compliance: Customer Data Deletion
 * Triggered when a customer requests data deletion
 * Must complete within 30 days
 * Sent 10 days after request (or 6 months if recent orders exist)
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop, payload } = await authenticate.webhook(request);

    console.log("🗑️  GDPR: Customer redaction request received", {
      shop,
      customerId: payload.customer?.id,
      customerEmail: payload.customer?.email,
      ordersToRedact: payload.orders_to_redact?.length || 0,
    });

    // Find store
    const store = await db.store.findUnique({
      where: { shopDomain: shop },
    });

    if (store) {
      // Find all sessions for this customer
      const sessions = await db.chatSession.findMany({
        where: {
          storeId: store.id,
          customerEmail: payload.customer?.email,
        },
      });

      let deletedSessions = 0;
      let deletedMessages = 0;

      // Delete all messages and sessions
      for (const session of sessions) {
        // Delete messages first (foreign key constraint)
        const result = await db.chatMessage.deleteMany({
          where: { sessionId: session.id },
        });
        deletedMessages += result.count;

        // Delete session
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

    // Must respond with 200 status
    return json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("❌ Error redacting customer data:", error);
    // Still return 200 to acknowledge receipt
    return json({ success: false, error: "Processing failed" }, { status: 200 });
  }
}

// Reject non-POST requests
export async function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
