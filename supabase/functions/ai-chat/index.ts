import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const GEMINI_MODEL = "gemini-2.0-flash";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const [scores, communities, categories, feedback] = await Promise.all([
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
    ]);

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

    const contents = [
      ...(Array.isArray(history) ? history.slice(-10).map((m: { role: string; text: string }) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.text }],
      })) : []),
      { role: "user", parts: [{ text: message }] },
    ];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(JSON.stringify({ error: `Gemini API error: ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiData = await geminiRes.json();
    const reply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "Sorry, I couldn't generate a response.";

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
