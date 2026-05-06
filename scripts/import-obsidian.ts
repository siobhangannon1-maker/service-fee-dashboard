import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { createEmbedding } from "../lib/openai";
import { supabaseScriptClient } from "./supabase-script-client";

type MarkdownFile = {
  absolutePath: string;
  relativePath: string;
  content: string;
};

type Chunk = {
  heading: string;
  content: string;
  chunkIndex: number;
};

function getAllMarkdownFiles(dir: string, baseDir = dir): MarkdownFile[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: MarkdownFile[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === ".obsidian") continue;
      files.push(...getAllMarkdownFiles(absolutePath, baseDir));
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push({
        absolutePath,
        relativePath: path.relative(baseDir, absolutePath),
        content: fs.readFileSync(absolutePath, "utf8"),
      });
    }
  }

  return files;
}

function getTitleFromMarkdown(relativePath: string, body: string): string {
  const firstHeading = body.match(/^#\s+(.+)$/m);

  if (firstHeading?.[1]) {
    return firstHeading[1].trim();
  }

  return path.basename(relativePath, ".md");
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function chunkMarkdown(body: string): Chunk[] {
  const lines = body.split("\n");
  const chunks: Chunk[] = [];

  let currentHeading = "Main";
  let currentLines: string[] = [];

  function pushChunk() {
    const content = currentLines.join("\n").trim();

    if (content.length < 40) {
      currentLines = [];
      return;
    }

    chunks.push({
      heading: currentHeading,
      content,
      chunkIndex: chunks.length,
    });

    currentLines = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,3})\s+(.+)$/);

    if (headingMatch) {
      pushChunk();
      currentHeading = headingMatch[2].trim();
      currentLines.push(line);
    } else {
      currentLines.push(line);
    }
  }

  pushChunk();

  if (chunks.length === 0 && body.trim().length > 0) {
    chunks.push({
      heading: "Main",
      content: body.trim(),
      chunkIndex: 0,
    });
  }

  return chunks;
}

async function importFile(file: MarkdownFile) {
  const parsed = matter(file.content);
  const rawBody = parsed.content.trim();
  const title = getTitleFromMarkdown(file.relativePath, rawBody);

  const noteType = parsed.data.type ?? null;
  const department = parsed.data.department ?? null;
  const priority = parsed.data.priority ?? null;
  const tags = Array.isArray(parsed.data.tags) ? parsed.data.tags : [];

  console.log(`Importing: ${title}`);

  const { data: document, error: documentError } = await supabaseScriptClient
    .from("knowledge_documents")
    .upsert(
      {
        title,
        file_path: file.relativePath,
        note_type: noteType,
        department,
        priority,
        tags,
        raw_content: rawBody,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "file_path",
      }
    )
    .select("id")
    .single();

  if (documentError || !document) {
    throw new Error(
      `Failed to upsert document ${title}: ${documentError?.message}`
    );
  }

  const { error: deleteError } = await supabaseScriptClient
    .from("knowledge_chunks")
    .delete()
    .eq("document_id", document.id);

  if (deleteError) {
    throw new Error(`Failed deleting old chunks: ${deleteError.message}`);
  }

  const chunks = chunkMarkdown(rawBody);

  for (const chunk of chunks) {
    const embeddingInput = [
      `Title: ${title}`,
      `Heading: ${chunk.heading}`,
      chunk.content,
    ].join("\n\n");

    const embedding = await createEmbedding(embeddingInput);

    const { error: chunkError } = await supabaseScriptClient
      .from("knowledge_chunks")
      .insert({
        document_id: document.id,
        title,
        heading: chunk.heading,
        content: chunk.content,
        chunk_index: chunk.chunkIndex,
        token_estimate: estimateTokens(chunk.content),
        embedding,
        metadata: {
          file_path: file.relativePath,
          note_type: noteType,
          department,
          priority,
          tags,
        },
      });

    if (chunkError) {
      throw new Error(`Failed inserting chunk: ${chunkError.message}`);
    }
  }

  console.log(`Imported ${chunks.length} chunks for ${title}`);
}

async function main() {
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH;

  if (!vaultPath) {
    throw new Error("Missing OBSIDIAN_VAULT_PATH in .env.local");
  }

  if (!fs.existsSync(vaultPath)) {
    throw new Error(`Vault path does not exist: ${vaultPath}`);
  }

  const files = getAllMarkdownFiles(vaultPath);

  console.log(`Found ${files.length} markdown files`);

  for (const file of files) {
    await importFile(file);
  }

  console.log("Obsidian import complete");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});