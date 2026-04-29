import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const trelloApiKey = process.env.TRELLO_API_KEY!;
const trelloToken = process.env.TRELLO_TOKEN!;
const trelloListId = process.env.TRELLO_LIST_ID!;

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

export async function POST(request: Request) {
  try {
    const { taskId } = await request.json();

    if (!taskId) {
      return NextResponse.json(
        { error: "Missing taskId" },
        { status: 400 }
      );
    }

    const { data: task, error: taskError } = await supabaseAdmin
      .from("practice_manager_tasks")
      .select("*")
      .eq("id", taskId)
      .single();

    if (taskError || !task) {
      return NextResponse.json(
        { error: "Task not found" },
        { status: 404 }
      );
    }

    if (task.synced_to_trello && task.trello_card_url) {
      return NextResponse.json({
        success: true,
        message: "Task already synced to Trello",
        trelloCardUrl: task.trello_card_url,
      });
    }

    const cardName = task.title || "Untitled practice task";

    const cardDescription = `
Practice Manager Task

Title: ${task.title || ""}
Description: ${task.description || ""}
Priority: ${task.priority || ""}
Status: ${task.status || ""}
Due Date: ${task.due_date || ""}

Created from DocuDental dashboard.
`.trim();

    const trelloResponse = await fetch("https://api.trello.com/1/cards", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: trelloApiKey,
        token: trelloToken,
        idList: trelloListId,
        name: cardName,
        desc: cardDescription,
        due: task.due_date || null,
      }),
    });

    const trelloCard = await trelloResponse.json();

    if (!trelloResponse.ok) {
      return NextResponse.json(
        {
          error: "Failed to create Trello card",
          details: trelloCard,
        },
        { status: 500 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("practice_manager_tasks")
      .update({
        trello_card_id: trelloCard.id,
        trello_card_url: trelloCard.url,
        synced_to_trello: true,
      })
      .eq("id", taskId);

    if (updateError) {
      return NextResponse.json(
        {
          error: "Trello card created, but failed to update Supabase task",
          trelloCardUrl: trelloCard.url,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      trelloCardUrl: trelloCard.url,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unexpected error creating Trello card",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}