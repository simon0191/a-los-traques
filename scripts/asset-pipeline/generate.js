/**
 * generate.js — Gemini image generation wrapper
 *
 * Wraps the Gemini API for single-image generation with retry logic.
 * Supports optional reference image input for style consistency.
 */

import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";

let aiInstance = null;

function getAI() {
  if (!aiInstance) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY environment variable is not set.\n" +
          "Get a key at https://aistudio.google.com/apikey"
      );
    }
    aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return aiInstance;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a single image via Gemini.
 *
 * @param {object} opts
 * @param {string} opts.prompt - Text prompt
 * @param {string} opts.outputPath - Where to save the PNG
 * @param {string} [opts.model='gemini-2.5-flash-image'] - Model ID
 * @param {string|string[]} [opts.inputPaths] - Optional reference image path(s)
 * @param {number} [opts.retries=3] - Max attempts
 * @param {number} [opts.delay=3000] - Delay between retries (ms)
 * @returns {Promise<{success: boolean, path?: string, bytes?: number, error?: string}>}
 */
export async function generateImage({
  prompt,
  outputPath,
  model = "gemini-2.5-flash-image",
  inputPaths = null,
  retries = 3,
  delay = 3000,
}) {
  const ai = getAI();
  const contents = [];

  // Normalize to array
  const refPaths = inputPaths
    ? Array.isArray(inputPaths) ? inputPaths : [inputPaths]
    : [];

  let addedRefs = 0;
  for (const inputPath of refPaths) {
    if (inputPath && fs.existsSync(inputPath)) {
      const imageData = fs.readFileSync(inputPath);
      const ext = path.extname(inputPath).toLowerCase().replace(".", "");
      const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      contents.push({
        inlineData: { mimeType, data: imageData.toString("base64") },
      });
      addedRefs++;
    }
  }

  // If reference images were provided, prepend a consistency instruction
  const refPrefix = addedRefs > 0
    ? `The generated character must look EXACTLY like the character in the reference image${addedRefs > 1 ? "s" : ""} — same face, body type, clothing, hair, and colors. IMPORTANT: Character MUST face RIGHT — chest and face pointing toward the right side of the image. `
    : "";
  contents.push({ text: refPrefix + prompt });

  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: { responseModalities: ["IMAGE", "TEXT"] },
      });

      if (!response.candidates?.[0]?.content?.parts) {
        throw new Error("Empty response from API");
      }

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const buffer = Buffer.from(part.inlineData.data, "base64");
          const dir = path.dirname(outputPath);
          if (dir && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(outputPath, buffer);
          return { success: true, path: outputPath, bytes: buffer.length };
        }
      }

      // No image in response
      if (attempt < retries) {
        contents[contents.length - 1] = {
          text: `Generate an image: ${prompt}`,
        };
        await sleep(delay * attempt);
        continue;
      }
      throw new Error("No image data in response");
    } catch (err) {
      lastError = err;

      if (
        err.message?.includes("SAFETY") ||
        err.message?.includes("blocked")
      ) {
        return { success: false, error: `Safety filter: ${err.message}` };
      }

      if (
        err.message?.includes("429") ||
        err.message?.includes("RESOURCE_EXHAUSTED")
      ) {
        const wait = 8000 * attempt;
        console.warn(`  [Rate limited] Waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }

      if (attempt < retries) {
        await sleep(delay * attempt);
        continue;
      }
    }
  }

  return { success: false, error: lastError?.message || "Unknown error" };
}
