// Deploy: supabase functions deploy initiate-payment --no-verify-jwt
// Secrets needed (supabase secrets set ...):
//   LIPANA_SECRET_KEY   -> your lip_sk_live_... or lip_sk_test_... key from lipana.dev dashboard
//   LIPANA_API_BASE     -> https://api-sandbox.lipana.dev/v1 (testing) or https://api.lipana.dev/v1 (live)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase, no need to set manually.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { order, phone } = body; // order = full order object built client-side (no mpesa fields needed anymore)

    if (!order || !phone || !order.total) {
      return new Response(JSON.stringify({ error: "Missing order or phone" }), { status: 400, headers: CORS });
    }
    // Normalize to 2547XXXXXXXX for Lipana
    let msisdn = phone.replace(/\s+/g, "");
    if (msisdn.startsWith("0")) msisdn = "254" + msisdn.slice(1);
    if (msisdn.startsWith("+")) msisdn = msisdn.slice(1);
    if (!/^254\d{9}$/.test(msisdn)) {
      return new Response(JSON.stringify({ error: "Invalid phone number" }), { status: 400, headers: CORS });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Create the order first, unpaid, so we have an ID to reconcile the webhook against.
    const { data: created, error: insertErr } = await supabase
      .from("orders")
      .insert([{ ...order, status: "pending", payment_status: "pending", payment_method: "mpesa" }])
      .select()
      .single();
    if (insertErr) throw insertErr;

    // 2. Trigger the real STK push via Lipana.
    const apiBase = Deno.env.get("LIPANA_API_BASE") ?? "https://api-sandbox.lipana.dev/v1";
    const stkRes = await fetch(`${apiBase}/transactions/stk-push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("LIPANA_SECRET_KEY")!,
      },
      body: JSON.stringify({
        phone: `+${msisdn}`,
        amount: Math.round(order.total),
        accountReference: `STAWEAR-${created.id}`,
        transactionDesc: `Stawear order #${created.id}`,
      }),
    });
    const stkData = await stkRes.json();

    if (!stkRes.ok || !stkData.transactionId) {
      // Roll the order back to failed rather than leaving it stuck pending forever.
      await supabase.from("orders").update({ payment_status: "failed" }).eq("id", created.id);
      return new Response(JSON.stringify({ error: stkData.message || "STK push failed" }), { status: 502, headers: CORS });
    }

    await supabase
      .from("orders")
      .update({ lipana_transaction_id: stkData.transactionId })
      .eq("id", created.id);

    return new Response(
      JSON.stringify({ orderId: created.id, transactionId: stkData.transactionId }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: CORS });
  }
});
