import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR Compliance: Customer Data Request
 * Triggered when a customer requests their data
 * Must respond within 30 days
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop, payload } = await authenticate.webhook(request);

    console.log("📋 GDPR: Customer data request received", {
      shop,
      customerId: payload.customer?.id,
      customerEmail: payload.customer?.email,
      ordersRequested: payload.orders_requested?.length || 0,
    });

    // Find store
    const store = await db.store.findUnique({
      where: { shopDomain: shop },
    });

    if (store) {
      // Find all chat sessions for this customer
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
        messagesFound: customerData.totalMessages,
      });

      // TODO: In production, send this data to the customer via email
      // For now, log it for compliance purposes
    }

    // Must respond with 200 status
    return json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("❌ Error processing customer data request:", error);
    // Still return 200 to acknowledge receipt
    return json({ success: false, error: "Processing failed" }, { status: 200 });
  }
}

// Reject non-POST requests
export async function loader() {
  return json({ error: "Method not allowed" }, { status: 405 });
}
