import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({});

// 1. A dynamic in-memory database
const PAST_INCIDENTS: { id: string, issue: string, resolution: string }[] = [];

// Helper to compute text similarity (Jaccard Index)
function calculateTextSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(textA.toLowerCase().split(/\\W+/).filter(w => w.length > 4));
  const wordsB = new Set(textB.toLowerCase().split(/\\W+/).filter(w => w.length > 4));
  
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  
  const union = wordsA.size + wordsB.size - intersection;
  return intersection / union;
}

// Add a new incident to the dynamic memory
export function addIncidentToMemory(id: string, issue: string, resolution: string) {
  // Prevent exact duplicates for demo purposes
  if (!PAST_INCIDENTS.find(inc => inc.id === id)) {
    PAST_INCIDENTS.push({ id, issue, resolution });
    console.log(`[Memory] Saved incident ${id} to RAG database.`);
  }
}

// 3. Search function (The actual RAG retrieval)
export async function searchIncidentMemory(currentErrorText: string) {
  
  let bestMatch = null;
  let highestScore = -1;

  for (const incident of PAST_INCIDENTS) {
    const score = calculateTextSimilarity(currentErrorText, incident.issue);
    console.log(`[Memory Debug] Compared with ${incident.id}: Score = ${score.toFixed(3)}`);
    if (score > highestScore) {
      highestScore = score;
      bestMatch = incident;
    }
  }

  // Threshold: Set to 0.15 for basic keyword overlap
  if (highestScore > 0.15 && bestMatch) {
    return {
      incidentId: bestMatch.id,
      past_issue: bestMatch.issue,
      past_resolution: bestMatch.resolution,
      confidence_score: (highestScore * 100).toFixed(1) + "%"
    };
  }

  return null; // No similar past incident found
}
