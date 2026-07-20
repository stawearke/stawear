// Deploy: supabase functions deploy lipana-webhook --no-verify-jwt
// After deploying, register this function's URL as your webhook endpoint in the Lipana dashboard:
//   https://<project-ref>.supabase.co/functions/v1/lipana-webhook
// Secret needed: LIPANA_WEBHOOK_SECRET (shown once in the Lipana dashboard webhook settings)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function verifySignature(rawBody: string, signature: string, secret: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const computed = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // constant-time-ish compare
  if (computed.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const signature = req.headers.get("x-lipana-signature");
  const secret = Deno.env.get("LIPANA_WEBHOOK_SECRET")!;
  const rawBody = await req.text();

  if (!signature || !(await verifySignature(rawBody, signature, secret))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = JSON.parse(rawBody);
  const payload = body.data || body;
  const txnId = payload.transactionId || payload.transaction_id;
  const receipt = payload.mpesaReceiptNumber || payload.receiptNumber || payload.receipt_number || null;
  if (!txnId) return new Response("OK", { status: 200 }); // nothing to reconcile, ack anyway

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const isSuccess = body.event === "transaction.success" || payload.status === "success" || payload.status === "COMPLETED";
  const isFailure = body.event === "transaction.failed" || payload.status === "failed" || payload.status === "FAILED";

  if (isSuccess) {
    await supabase
      .from("orders")
      .update({ payment_status: "paid", mpesa_receipt: receipt })
      .eq("lipana_transaction_id", txnId);
  } else if (isFailure) {
    await supabase
      .from("orders")
      .update({ payment_status: "failed" })
      .eq("lipana_transaction_id", txnId);
  }

  return new Response("OK", { status: 200 });
});
