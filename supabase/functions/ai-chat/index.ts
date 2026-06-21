import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
// Tried in order; a model temporarily rate-limited upstream falls through to the next.
const OPENROUTER_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "google/gemini-2.0-flash-exp:free",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms at: ${label}`)), ms)),
  ]);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tries each free model in order. On a 429 (upstream provider temporarily
// rate-limited), retries the same model once after the suggested delay,
// then falls through to the next model in the list.
async function callOpenRouter(messages: unknown[]): Promise<string> {
  let lastError = "Unknown error";

  for (const model of OPENROUTER_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://vtcouncil.online",
          "X-Title": "VTC Scorecard",
        },
        body: JSON.stringify({ model, messages }),
      });

      if (res.ok) {
        const data = await res.json();
        return data?.choices?.[0]?.message?.content ?? "Sorry, I couldn't generate a response.";
      }

      const errText = await res.text();
      lastError = errText;

      if (res.status === 429 && attempt === 0) {
        let retryAfterMs = 3000;
        try {
          const parsed = JSON.parse(errText);
          const seconds = parsed?.error?.metadata?.retry_after_seconds;
          if (typeof seconds === "number") retryAfterMs = Math.min(seconds * 1000 + 500, 12000);
        } catch { /* use default delay */ }
        console.log(`ai-chat: ${model} rate-limited, retrying in ${retryAfterMs}ms`);
        await sleep(retryAfterMs);
        continue;
      }

      console.log(`ai-chat: ${model} failed (${res.status}), trying next model`);
      break;
    }
  }

  throw new Error(`All models exhausted. Last error: ${lastError}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { message, history } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Missing message" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Scoped to the calling user's session — RLS applies exactly as it would
    // for any other client query. This function only ever performs SELECTs;
    // it has no path to writing or mutating data.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    console.log("ai-chat: fetching context");
    const [scores, communities, categories, feedback] = await withTimeout(
      Promise.all([
        supabase
          .from("score_results")
          .select("weighted_total, safety_score, schedule_score, rework_score, feedback_score, overall_rank, vendors(name, vendor_categories(name))")
          .order("weighted_total", { ascending: false, nullsFirst: false }),
        supabase.from("communities").select("name, code, brand"),
        supabase.from("vendor_categories").select("name"),
        supabase
          .from("builder_feedback")
          .select("category, severity, points, description, created_at, vendors(name)")
          .eq("is_approved", true)
          .order("created_at", { ascending: false })
          .limit(30),
      ]),
      15000,
      "fetch context from database"
    );
    console.log("ai-chat: context fetched, calling OpenRouter");

    const context = {
      vendor_scores: scores.data ?? [],
      communities: communities.data ?? [],
      categories: categories.data ?? [],
      recent_approved_feedback: feedback.data ?? [],
    };

    const systemPrompt = `You are a read-only data assistant embedded in the VTC Scorecard app, a vendor/trade-contractor performance tracker for homebuilders.
You can ONLY answer questions using the JSON data provided below. You cannot take any action, modify any data, or access anything outside this snapshot.
If the answer isn't in the data, say so plainly. Keep answers concise and reference specific vendor/community names and numbers from the data when relevant.

DATA SNAPSHOT (current as of this message):
${JSON.stringify(context)}`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(Array.isArray(history) ? history.slice(-10).map((m: { role: string; text: string }) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.text,
      })) : []),
      { role: "user", content: message },
    ];

    let reply: string;
    try {
      reply = await withTimeout(callOpenRouter(messages), 30000, "OpenRouter API call (with retries)");
    } catch (err) {
      console.error("ai-chat: OpenRouter API error", err);
      return new Response(JSON.stringify({ error: `OpenRouter API error: ${err instanceof Error ? err.message : err}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("ai-chat: success");

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ai-chat: error", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
