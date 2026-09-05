import { GoogleGenAI } from "@google/genai";
import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Generate an embedding array using Gemini
async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: text,
    });
    return response.embeddings?.[0]?.values || [];
  } catch (error) {
    console.error("Embedding generation failed. Using mock vector for fallback.", error);
    // Fallback so the demo doesn't crash if the embedding API endpoint acts up
    return Array(768).fill(Math.random());
  }
}

// Ensure the DB is ready
export async function initMemoryDB() {
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    await client.query(`
      CREATE TABLE IF NOT EXISTS incident_memory (
        id VARCHAR(50) PRIMARY KEY,
        issue TEXT NOT NULL,
        resolution TEXT NOT NULL,
        embedding vector(768)
      )
    `);
    console.log("✅ Supabase pgvector Database initialized!");
  } catch (err) {
    console.error("Error initializing DB:", err);
  } finally {
    client.release();
  }
}

// Add a new incident to the database
export async function addIncidentToMemory(id: string, issue: string, resolution: string) {
  const embedding = await getEmbedding(issue);
  if (embedding.length === 0) return;

  const client = await pool.connect();
  try {
    const embeddingStr = `[${embedding.join(',')}]`;
    await client.query(
      `INSERT INTO incident_memory (id, issue, resolution, embedding) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (id) DO NOTHING`,
      [id, issue, resolution, embeddingStr]
    );
    console.log(`[Memory] Saved incident ${id} to Supabase pgvector database.`);
  } catch (err) {
    console.error("Error saving incident to DB:", err);
  } finally {
    client.release();
  }
}

// Search function (The actual RAG retrieval)
export async function searchIncidentMemory(currentErrorText: string) {
  const queryVector = await getEmbedding(currentErrorText);
  if (queryVector.length === 0) return null;

  const client = await pool.connect();
  try {
    const embeddingStr = `[${queryVector.join(',')}]`;
    // <=> is cosine distance. 1 - distance = cosine similarity
    const result = await client.query(`
      SELECT id, issue, resolution, 1 - (embedding <=> $1) as similarity
      FROM incident_memory
      ORDER BY embedding <=> $1
      LIMIT 1
    `, [embeddingStr]);

    if (result.rows.length > 0) {
      const match = result.rows[0];
      if (match.similarity > 0.65) {
         return {
            incidentId: match.id,
            past_issue: match.issue,
            past_resolution: match.resolution,
            confidence_score: (match.similarity * 100).toFixed(1) + "%"
         };
      }
    }
    return null;
  } catch (err) {
    console.error("Error searching DB:", err);
    return null;
  } finally {
    client.release();
  }
}
