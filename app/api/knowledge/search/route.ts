import { NextRequest, NextResponse } from "next/server";

import { createEmbedding } from "@/lib/openai";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const query = body.query;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Missing query" },
        { status: 400 }
      );
    }

    const embedding = await createEmbedding(query);

    const { data, error } = await supabaseAdmin.rpc(
      "match_knowledge_chunks",
      {
        query_embedding: embedding,
        match_count: 8,
        match_threshold: 0.2,
      }
    );

    if (error) {
      console.error(error);

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      results: data ?? [],
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}