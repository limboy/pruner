#!/usr/bin/env node

import { Command } from "commander";
import { execFileSync } from "child_process";
import chalk from "chalk";
import fs from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, ".env");
try {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {}

const CACHE_DIR = resolve(__dirname, ".cache");

const LANG_MAP = {
  zh: "Chinese",
  cn: "Chinese",
  chinese: "Chinese",
  中文: "Chinese",
  en: "English",
  english: "English",
  ja: "Japanese",
  jp: "Japanese",
  japanese: "Japanese",
  ko: "Korean",
  kr: "Korean",
  korean: "Korean",
  fr: "French",
  french: "French",
  de: "German",
  german: "German",
  es: "Spanish",
  spanish: "Spanish",
  pt: "Portuguese",
  portuguese: "Portuguese",
  ru: "Russian",
  russian: "Russian",
  ar: "Arabic",
  arabic: "Arabic",
};

function resolveLang(lang) {
  return LANG_MAP[lang.toLowerCase()] || lang;
}

function getLabels(lang) {
  const resolved = resolveLang(lang);
  const isChinese = resolved === "Chinese";
  return isChinese
    ? {
        prunedSuffix: "精简版",
        videoLink: "视频链接",
        articleLink: "原文链接",
        fileLink: "文件路径",
        contentPrune: "内容精简",
        keyPoints: "要点提炼",
        excerpts: "原文摘录",
        qaSection: "深度问答",
        plotPrune: "剧情精简",
        synopsis: "简介",
        highlights: "看点提炼",
        classicLines: "经典台词",
      }
    : {
        prunedSuffix: "Pruned Version",
        videoLink: "Video",
        articleLink: "Source",
        fileLink: "File",
        contentPrune: "Dense Reconstruction",
        keyPoints: "Key Takeaways",
        excerpts: "Original Excerpts",
        qaSection: "Deep Q&A",
        plotPrune: "Plot Reconstruction",
        synopsis: "Synopsis",
        highlights: "Highlights",
        classicLines: "Memorable Lines",
      };
}

function detectInputType(input) {
  if (input.startsWith("http://") || input.startsWith("https://")) {
    if (input.includes("youtube.com") || input.includes("youtu.be")) {
      return { type: "youtube", resolved: input };
    }
    return { type: "url", resolved: input };
  }
  if (input.endsWith(".md")) {
    const fullPath = resolve(process.cwd(), input);
    if (fs.existsSync(fullPath)) {
      return { type: "markdown", resolved: fullPath };
    }
  }
  return { type: "book", resolved: input };
}

// Normalize a user-supplied --type value into a canonical type, or null if unset/unknown.
function normalizeForcedType(t) {
  if (!t) return null;
  const v = String(t).toLowerCase().trim();
  if (["tv", "series", "tvseries", "tv-series", "show"].includes(v)) return "tv";
  if (["movie", "film"].includes(v)) return "movie";
  if (["book"].includes(v)) return "book";
  return null;
}

// Detect a season specifier in a TV title, e.g. "Chernobyl S01", "Breaking Bad S2",
// "The Wire Season 1". Returns { show, seasonNum } or null. When present, each
// episode of that season is pruned individually (like a movie).
function parseSeason(title) {
  const m = title.match(/\b(?:s|season)\s*0*(\d+)\b/i);
  if (!m) return null;
  const seasonNum = parseInt(m[1], 10);
  const show = title.replace(m[0], "").replace(/\s+/g, " ").trim();
  if (!show) return null;
  return { show, seasonNum };
}

// Strip any leading "Chapter N:" / "第N章" prefix from markdown headings, keeping
// only the descriptive title.
function stripChapterPrefix(text) {
  return text
    .replace(/^(#{2,4})\s*Chapter\s*\d+\s*[:：.、)\]]?\s*/gim, "$1 ")
    .replace(
      /^(#{2,4})\s*第\s*[\d一二三四五六七八九十百零]+\s*章\s*[:：.、)\]]?\s*/gim,
      "$1 ",
    );
}

// Apply a forced type (from --type) on top of auto-detection. Title-based types
// (book/tv/movie) treat the raw input as the title.
function resolveInputType(input, forcedType) {
  const forced = normalizeForcedType(forcedType);
  if (forced) {
    return { type: forced, resolved: input };
  }
  return detectInputType(input);
}

const program = new Command();

program
  .name("pruner")
  .description(
    "Prune content from books or YouTube videos into a dense version.",
  )
  .version("1.0.0")
  .argument(
    "<input>",
    "Book title, YouTube URL, local .md file, or .txt file (one input per line)",
  )
  .option("-o, --output <path>", "Output directory or file path")
  .option(
    "-b, --batch-size <number>",
    "Number of sections per batch",
    process.env.SECTIONS_PER_BATCH || "3",
  )
  .option(
    "-c, --concurrency <number>",
    "Number of parallel requests",
    process.env.CONCURRENCY || "3",
  )
  .option(
    "-l, --lang <language>",
    "Output language",
    process.env.OUTPUT_LANG || "Chinese",
  )
  .option(
    "-t, --type <type>",
    "Force input type: book, tv, or movie (overrides auto-detection)",
  )
  .action(async (input, opts) => {
    const batchSize = parseInt(opts.batchSize, 10);
    const concurrency = parseInt(opts.concurrency, 10);

    if (input.endsWith(".txt")) {
      const fullPath = resolve(process.cwd(), input);
      if (fs.existsSync(fullPath)) {
        const lines = fs
          .readFileSync(fullPath, "utf-8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"));
        console.log(
          chalk.blue(`\n📋 Found ${lines.length} inputs in ${input}`),
        );
        for (const line of lines) {
          const { type, resolved } = resolveInputType(line, opts.type);
          await handlePrune(
            type,
            resolved,
            opts.output,
            batchSize,
            concurrency,
            opts.lang,
          );
        }
        return;
      }
    }

    const { type, resolved } = resolveInputType(input, opts.type);
    await handlePrune(
      type,
      resolved,
      opts.output,
      batchSize,
      concurrency,
      opts.lang,
    );
  });

program.parse();

function sanitizeFilename(name) {
  // Replace problematic characters : & / \ | # with '-' and trim whitespace
  return String(name)
    .replace(/[:&\/\\|#]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveOutputPath(output, title) {
  const safeTitle = sanitizeFilename(title);
  if (output) {
    if (output.endsWith(".md")) return output;
    return resolve(output, `${safeTitle}.md`);
  }
  return `${safeTitle}.md`;
}

async function handlePrune(type, input, output, batchSize, concurrency, lang) {
  lang = resolveLang(lang);
  try {
    // For types where title is known upfront, skip if output already exists
    if (
      type === "book" ||
      type === "markdown" ||
      type === "tv" ||
      type === "movie"
    ) {
      const title =
        type === "markdown"
          ? input.replace(/^.*[\\\/]/, "").replace(/\.md$/i, "")
          : input;
      const outPath = resolveOutputPath(output, title);
      if (fs.existsSync(outPath)) {
        console.log(chalk.gray(`\n⏭️  Skipped (already exists): ${outPath}`));
        return;
      }
    }

    console.log(chalk.blue(`\n🚀 Processing ${type}: ${chalk.bold(input)}...`));

    let sourceContent = "";
    let title = input;

    if (type === "youtube") {
      sourceContent = await fetchYoutubeTranscript(input);
      if (!sourceContent) {
        throw new Error("Could not retrieve YouTube transcript.");
      }
      title = await fetchYoutubeTitle(input);
    } else if (type === "url") {
      const parsed = await fetchUrlContent(input);
      sourceContent = parsed.content;
      if (!sourceContent) {
        throw new Error("Could not retrieve content from URL.");
      }
      title = parsed.title;
    } else if (type === "markdown") {
      sourceContent = fs.readFileSync(input, "utf-8");
      if (!sourceContent) {
        throw new Error("Could not read content from markdown file.");
      }
      title = input.replace(/^.*[\\\/]/, "").replace(/\.md$/i, "");
    }

    // For youtube/url, title is only known after fetching — check now
    if (type === "youtube" || type === "url") {
      const outPath = resolveOutputPath(output, title);
      if (fs.existsSync(outPath)) {
        console.log(chalk.gray(`\n⏭️  Skipped (already exists): ${outPath}`));
        return;
      }
    }

    console.log(chalk.yellow("✂️  Starting multi-step pruning process..."));
    const pruned = await pruneContent(
      type,
      input,
      title,
      sourceContent,
      batchSize,
      concurrency,
      lang,
    );

    const outputPath = resolveOutputPath(output, title);
    const parentDir = dirname(outputPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, pruned);
    cleanCache(input);

    console.log(
      chalk.green(
        `\n✅ Done! Pruned version saved to: ${chalk.bold(outputPath)}`,
      ),
    );
  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}`));
  }
}

async function fetchYoutubeTitle(url) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.title) return data.title.trim();
    }
  } catch {}
  return url.match(/(?:v=|youtu\.be\/)([^&]+)/)?.[1] || "video";
}

async function fetchUrlContent(url) {
  try {
    const output = execFileSync("npx", ["defuddle", "parse", url, "--json"], {
      encoding: "utf-8",
    });
    const data = JSON.parse(output);
    return {
      content: data.contentMarkdown,
      title: data.title || url,
    };
  } catch (error) {
    throw new Error(`Failed to fetch URL content: ${error.message}`);
  }
}

function fetchYoutubeTranscript(url) {
  const tmpBase = `_sub_${Date.now()}`;
  const tmpFile = resolve(CACHE_DIR, tmpBase);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  let foundFiles = [];
  try {
    execFileSync(
      "yt-dlp",
      [
        "--cookies-from-browser",
        "chrome",
        "--js-runtimes",
        "node",
        "--write-auto-sub",
        "--sub-lang",
        "en",
        "--sub-format",
        "json3",
        "--skip-download",
        "-o",
        tmpFile,
        url,
      ],
      { stdio: "pipe" },
    );

    // yt-dlp may download as .json3 or .vtt depending on version/availability
    foundFiles = fs
      .readdirSync(CACHE_DIR)
      .filter(
        (f) =>
          f.startsWith(tmpBase) && (f.endsWith(".json3") || f.endsWith(".vtt")),
      );

    if (foundFiles.length === 0) {
      throw new Error("No subtitle file was downloaded by yt-dlp.");
    }

    const subFile = resolve(CACHE_DIR, foundFiles[0]);
    const raw = fs.readFileSync(subFile, "utf-8");

    if (subFile.endsWith(".json3")) {
      const data = JSON.parse(raw);
      return data.events
        .filter((e) => e.segs)
        .map((e) => e.segs.map((s) => s.utf8).join(""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }

    // Parse VTT format
    return parseVtt(raw);
  } catch (error) {
    throw new Error(`Failed to fetch YouTube transcript: ${error.message}`);
  } finally {
    for (const f of foundFiles) {
      try {
        fs.unlinkSync(resolve(CACHE_DIR, f));
      } catch {}
    }
  }
}

function parseVtt(vttContent) {
  const lines = vttContent.split("\n");
  const textLines = [];
  const seen = new Set();
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip headers, timestamps, and empty lines
    if (
      !trimmed ||
      trimmed === "WEBVTT" ||
      trimmed.startsWith("Kind:") ||
      trimmed.startsWith("Language:") ||
      trimmed.includes(" --> ")
    )
      continue;
    // Remove VTT tags like <c> </c> and speaker tags like <v Name>
    const cleaned = trimmed.replace(/<[^>]+>/g, "").trim();
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      textLines.push(cleaned);
    }
  }
  return textLines.join(" ").replace(/\s+/g, " ").trim();
}

function cacheKey(input) {
  return input.replace(/[^a-z0-9一-鿿]/gi, "_");
}

function getCachedSection(input, index) {
  try {
    return fs.readFileSync(
      resolve(CACHE_DIR, `${cacheKey(input)}_${index}.md`),
      "utf-8",
    );
  } catch {
    return null;
  }
}

function cacheSection(input, index, content) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    resolve(CACHE_DIR, `${cacheKey(input)}_${index}.md`),
    content,
  );
}

function getCachedOutline(input) {
  try {
    return JSON.parse(
      fs.readFileSync(
        resolve(CACHE_DIR, `${cacheKey(input)}_outline.json`),
        "utf-8",
      ),
    );
  } catch {
    return null;
  }
}

function cacheOutline(input, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    resolve(CACHE_DIR, `${cacheKey(input)}_outline.json`),
    JSON.stringify(data),
  );
}

function cleanCache(input) {
  try {
    const prefix = cacheKey(input);
    const qaPrefix = cacheKey(input + "__qa");
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (f.startsWith(prefix) || f.startsWith(qaPrefix))
        fs.unlinkSync(resolve(CACHE_DIR, f));
    }
    if (fs.readdirSync(CACHE_DIR).length === 0) fs.rmdirSync(CACHE_DIR);
  } catch {}
}

async function pruneContent(
  type,
  input,
  title,
  sourceContent,
  batchSize,
  concurrency,
  lang,
) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY is missing in .env file");
  }

  const baseUrl = process.env.API_BASE_URL || "https://openrouter.ai/api/v1";
  const modelName = process.env.MODEL || "deepseek/deepseek-v4-flash";

  async function chat(prompt) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  }

  if (type === "youtube" || type === "url" || type === "markdown") {
    return await pruneGenericContent(
      chat,
      type,
      input,
      title,
      sourceContent,
      batchSize,
      concurrency,
      lang,
    );
  }
  if (type === "tv" || type === "movie") {
    return await pruneVisualMedia(
      chat,
      type,
      input,
      batchSize,
      concurrency,
      lang,
    );
  }
  return await pruneBook(chat, input, batchSize, concurrency, lang);
}

async function generateQA(
  chat,
  input,
  sourceContent,
  batchSize,
  concurrency,
  lang,
  subject = "book",
) {
  const labels = getLabels(lang);
  const qaInput = input + "__qa";

  let questions = [];
  const cachedQ = getCachedOutline(qaInput);
  if (cachedQ) {
    questions = cachedQ.outline;
    console.log(chalk.gray("   Q&A questions (loaded from cache)"));
  } else {
    console.log(chalk.yellow("❓ Generating essential questions..."));
    const questionPrompt = sourceContent
      ? `Based on the following content, generate 5-10 essential questions that would help a reader deeply understand the material. These questions should cover the most important concepts, arguments, insights, and implications. Output language: ${lang}.

Output strictly as a numbered list, one question per line. Do not include any other text.

Content:
${sourceContent}`
      : `For the ${subject} "${input}", generate 5-10 essential questions that would help someone deeply understand it. These questions should cover the most important concepts, plot points, characters, themes, insights, and implications. Output language: ${lang}.

Output strictly as a numbered list, one question per line. Do not include any other text.`;

    const questionsRaw = await chat(questionPrompt);
    questions = questionsRaw
      .split("\n")
      .map((line) => line.replace(/^\d+[\.\、．)\]】\s]+/, "").trim())
      .filter((line) => line.length > 0);

    cacheOutline(qaInput, { summary: "", outline: questions });
  }

  const batches = [];
  for (let i = 0; i < questions.length; i += batchSize) {
    batches.push(questions.slice(i, i + batchSize));
  }

  console.log(
    chalk.yellow(
      `❓ ${questions.length} questions in ${batches.length} batches. Getting answers (concurrency: ${concurrency})...`,
    ),
  );

  const answers = new Array(batches.length);
  let completed = 0;

  async function processQABatch(batchIndex) {
    const batchQuestions = batches[batchIndex];
    const cached = getCachedSection(qaInput, batchIndex);
    if (cached) {
      answers[batchIndex] = cached;
      completed++;
      console.log(
        chalk.gray(
          `   [${completed}/${batches.length}] Q&A Batch ${batchIndex + 1} ${chalk.cyan("(cached)")}`,
        ),
      );
      return;
    }

    const questionList = batchQuestions
      .map((q, i) => `${i + 1}. ${q}`)
      .join("\n");
    const answerPrompt = sourceContent
      ? `Based on the following content, answer each question thoroughly and concisely. Each answer should be self-contained and provide deep insight. Output language: ${lang}.

Questions:
${questionList}

For each question, output in this format. Do not include any preamble, introduction, or summary text before or after the Q&A pairs. Start directly with the first ### Q:

### Q: [Question]
[Detailed, insightful answer]

Content:
${sourceContent}`
      : `Based on the ${subject} "${input}", answer each question thoroughly and concisely. Each answer should be self-contained and provide deep insight. Output language: ${lang}.

Questions:
${questionList}

For each question, output in this format. Do not include any preamble, introduction, or summary text before or after the Q&A pairs. Start directly with the first ### Q:

### Q: [Question]
[Detailed, insightful answer]`;

    let answerText = await chat(answerPrompt);
    answerText = answerText
      .trim()
      .replace(/^---+\s*\n*/, "")
      .replace(/\n*---+\s*$/, "");
    const firstQ = answerText.indexOf("### Q:");
    if (firstQ > 0) answerText = answerText.slice(firstQ);

    answers[batchIndex] = answerText;
    cacheSection(qaInput, batchIndex, answerText);
    completed++;
    console.log(
      chalk.gray(
        `   [${completed}/${batches.length}] Q&A Batch ${batchIndex + 1} (${batchQuestions.length} questions) ${chalk.green("✓")}`,
      ),
    );
  }

  for (let i = 0; i < batches.length; i += concurrency) {
    const batch = batches
      .slice(i, i + concurrency)
      .map((_, j) => processQABatch(i + j));
    await Promise.all(batch);
  }

  return `\n\n---\n\n## ${labels.qaSection}\n\n${answers.join("\n\n")}`;
}

async function pruneGenericContent(
  chat,
  type,
  input,
  title,
  sourceContent,
  batchSize,
  concurrency,
  lang,
) {
  let summary = "";
  let outline = [];

  const cachedOutline = getCachedOutline(input);
  if (cachedOutline) {
    summary = cachedOutline.summary;
    outline = cachedOutline.outline;
    console.log(chalk.gray("   (loaded from cache)"));
  } else {
    const contentType =
      type === "youtube"
        ? "YouTube video transcript"
        : type === "markdown"
          ? "markdown document"
          : "web article";
    const outlinePrompt = `Based on the following ${contentType} content, do two things. Output language: ${lang}.

1. First, write a paragraph summarizing the core content and theme.
2. Then generate a detailed content outline, dividing the content into logically clear modules, one item per line.

Output strictly in the following format, do not include other text:

===SUMMARY===
[summary content]

===OUTLINE===
[outline items, one per line]

Content:
${sourceContent}`;

    const outlineRaw = await chat(outlinePrompt);
    const summaryMatch = outlineRaw.match(
      /===SUMMARY===\s*([\s\S]*?)===OUTLINE===/,
    );
    const outlineMatch = outlineRaw.match(/===OUTLINE===\s*([\s\S]*)/);
    summary = summaryMatch ? summaryMatch[1].trim() : "";
    const outlineText = outlineMatch ? outlineMatch[1] : outlineRaw;
    outline = outlineText
      .split("\n")
      .map((line) => line.replace(/^[-*•\d.]+\s*/, "").trim())
      .filter(
        (line) => line.length > 0 && !line.toLowerCase().includes("outline"),
      );

    cacheOutline(input, { summary, outline });
  }

  const SECTIONS_PER_BATCH = batchSize;
  const batches = [];
  for (let i = 0; i < outline.length; i += SECTIONS_PER_BATCH) {
    batches.push(outline.slice(i, i + SECTIONS_PER_BATCH));
  }

  console.log(
    chalk.yellow(
      `📖 Found ${outline.length} sections in ${batches.length} batches. Generating dense content (concurrency: ${concurrency})...`,
    ),
  );

  const results = new Array(batches.length);
  let completed = 0;

  async function processBatch(batchIndex) {
    const sections = batches[batchIndex];
    const cached = getCachedSection(input, batchIndex);
    if (cached) {
      results[batchIndex] = cached;
      completed++;
      console.log(
        chalk.gray(
          `   [${completed}/${batches.length}] Batch ${batchIndex + 1} (${sections.length} sections) ${chalk.cyan("(cached)")}`,
        ),
      );
      return;
    }

    const sectionList = sections.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const labels = getLabels(lang);
    const contentType =
      type === "youtube"
        ? "video transcript"
        : type === "markdown"
          ? "markdown document"
          : "article content";
    const batchPrompt = `Task: Based on the following ${contentType}, provide a "Pruned Version" for each of the following sections. Output language: ${lang}.

Sections to process:
${sectionList}

For each section, output in this format:

## [Section Title]

### ${labels.contentPrune}
[High-density condensed version of the core content. Remove all filler, repetition, and irrelevant decoration. Retain all core insights, key facts, and logical steps. Keep specific details so it can be deeply understood without reading the original.]

### ${labels.keyPoints}
- [Key insight, fact, or core point 1]
- [Key insight, fact, or core point 2]
- ...

### ${labels.excerpts}
> [Extract the most brilliant and insightful original quotes from this section, 2-4 passages. Preserve original wording, do not rewrite. Quote them in the work's original language; only if that language is neither English nor Chinese, translate them into Chinese instead.]

---

Content:
${sourceContent}

Requirements:
1. Ensure the output has sufficiently high information density.
2. Even without reading the original, one should fully grasp the key points and details of each section.
3. Output each section in order, separated by ---.`;

    let batchText = await chat(batchPrompt);
    const firstHeading = batchText.indexOf("## ");
    if (firstHeading > 0) batchText = batchText.slice(firstHeading);

    // Trim and remove leading/trailing separators to avoid double HRs when joining
    batchText = batchText
      .trim()
      .replace(/^---+\s*\n*/, "")
      .replace(/\n*---+\s*$/, "");

    results[batchIndex] = batchText;
    cacheSection(input, batchIndex, batchText);
    completed++;
    console.log(
      chalk.gray(
        `   [${completed}/${batches.length}] Batch ${batchIndex + 1} (${sections.length} sections) ${chalk.green("✓")}`,
      ),
    );
  }

  for (let i = 0; i < batches.length; i += concurrency) {
    const batch = batches
      .slice(i, i + concurrency)
      .map((_, j) => processBatch(i + j));
    await Promise.all(batch);
  }

  const labels = getLabels(lang);
  const sourceLink =
    type === "youtube"
      ? `${labels.videoLink}: ${input}`
      : type === "markdown"
        ? `${labels.fileLink}: ${input}`
        : `${labels.articleLink}: ${input}`;
  let fullResult = `# ${title} ${labels.prunedSuffix}\n\n${sourceLink}\n\n`;
  if (summary) fullResult += `> ${summary}\n\n`;
  let combined = results.join("\n\n---\n\n");
  let sectionNum = 0;
  combined = combined.replace(
    /^## \d+[\.\、．]\s*/gm,
    () => `## ${++sectionNum}. `,
  );
  fullResult += combined;

  const qa = await generateQA(
    chat,
    input,
    sourceContent,
    batchSize,
    concurrency,
    lang,
  );
  fullResult += qa;

  return fullResult;
}

async function pruneBook(chat, input, batchSize, concurrency, lang) {
  let summary = "";
  let outline = [];

  const cachedOutline = getCachedOutline(input);
  if (cachedOutline) {
    summary = cachedOutline.summary;
    outline = cachedOutline.outline;
    console.log(chalk.gray("   (loaded from cache)"));
  } else {
    const outlinePrompt = `Do two things for the book "${input}". Output language: ${lang}.

1. First, write a paragraph summarizing the core content and theme of this book.
2. Then generate a detailed chapter/topic outline, one item per line.

Output strictly in the following format, do not include other text:

===SUMMARY===
[summary content]

===OUTLINE===
[outline items, one per line]`;

    const outlineRaw = await chat(outlinePrompt);
    const summaryMatch = outlineRaw.match(
      /===SUMMARY===\s*([\s\S]*?)===OUTLINE===/,
    );
    const outlineMatch = outlineRaw.match(/===OUTLINE===\s*([\s\S]*)/);
    summary = summaryMatch ? summaryMatch[1].trim() : "";
    const outlineText = outlineMatch ? outlineMatch[1] : outlineRaw;
    outline = outlineText
      .split("\n")
      .map((line) => line.replace(/^[-*•\d.]+\s*/, "").trim())
      .filter(
        (line) => line.length > 0 && !line.toLowerCase().includes("outline"),
      );

    cacheOutline(input, { summary, outline });
  }

  console.log(
    chalk.yellow(
      `📖 Found ${outline.length} sections. Generating dense content (concurrency: ${concurrency})...`,
    ),
  );

  const results = new Array(outline.length);
  let completed = 0;

  async function processSection(i) {
    const section = outline[i];
    const cached = getCachedSection(input, i);
    if (cached) {
      results[i] = cached;
      completed++;
      console.log(
        chalk.gray(
          `   [${completed}/${outline.length}] ${section} ${chalk.cyan("(cached)")}`,
        ),
      );
      return;
    }

    const labels = getLabels(lang);
    const sectionPrompt = `
      Task: Provide a "Pruned Version" for the chapter/topic "${section}" from the book "${input}". Output language: ${lang}.

      Format:
      ## ${section}

      ### ${labels.contentPrune}
      [Provide a high-density compressed version of the core content. Whether it's plot twists, character development, core theories, or logical chains, provide deep condensation. Remove all redundant decoration but retain core details and key cases/scenes that support content quality, enabling a substantive reading experience without the original.]

      ### ${labels.keyPoints}
      - [Core point, key plot, insight, or logical point 1]
      - [Core point, key plot, insight, or logical point 2]
      - ...

      ### ${labels.excerpts}
      > [Extract the most brilliant, insightful, or representative original passages from this chapter, 2-4 passages. Preserve original wording, do not rewrite. Quote them in the book's original language; only if that language is neither English nor Chinese, translate them into Chinese instead.]

      Requirements:
      1. This is not a simple summary, but a high-density reconstruction of the original content.
      2. Every sentence should carry extremely high information density.
      3. Even without reading the original, readers should gain knowledge or plot experience close to the original.
      4. Original excerpts must be actual quotes from the book, choosing passages that best embody the chapter's essence.
    `;

    let sectionText = await chat(sectionPrompt);
    const headingPos = sectionText.indexOf("## ");
    if (headingPos > 0) sectionText = sectionText.slice(headingPos);

    // Trim and remove leading/trailing separators to avoid double HRs when joining
    sectionText = sectionText
      .trim()
      .replace(/^---+\s*\n*/, "")
      .replace(/\n*---+\s*$/, "");

    results[i] = sectionText;
    cacheSection(input, i, sectionText);
    completed++;
    console.log(
      chalk.gray(
        `   [${completed}/${outline.length}] ${section} ${chalk.green("✓")}`,
      ),
    );
  }

  for (let i = 0; i < outline.length; i += concurrency) {
    const batch = outline
      .slice(i, i + concurrency)
      .map((_, j) => processSection(i + j));
    await Promise.all(batch);
  }

  const labels = getLabels(lang);
  let fullResult = `# 《${input}》 ${labels.prunedSuffix}\n\n`;
  if (summary) fullResult += `> ${summary}\n\n`;
  fullResult += results.join("\n\n---\n\n");

  const qa = await generateQA(chat, input, null, batchSize, concurrency, lang);
  fullResult += qa;

  return fullResult;
}

async function pruneVisualMedia(
  chat,
  type,
  input,
  batchSize,
  concurrency,
  lang,
) {
  // A "Chernobyl S01" style title means: prune each episode of that season individually.
  const season = type === "tv" ? parseSeason(input) : null;
  const isMovie = type === "movie";
  // A movie is a single unit (chapters are top-level). TV produces multiple units
  // (episodes or arcs), each becoming a container heading above its chapters.
  const multiUnit = !isMovie;
  const subject = isMovie ? "movie" : "TV series";
  const unitName = isMovie ? "movie" : season ? "episode" : "season/story arc";
  const unitPlural = isMovie ? "film" : season ? "episodes" : "arcs";

  // The subject the season/arc list describes (TV only).
  const outlineSubject = season
    ? `Season ${season.seasonNum} of the TV series "${season.show}"`
    : `the ${subject} "${input}"`;

  let summary = "";
  let units = [];

  const cachedOutline = getCachedOutline(input);
  if (cachedOutline) {
    summary = cachedOutline.summary;
    units = cachedOutline.outline;
    console.log(chalk.gray("   (loaded from cache)"));
  } else if (isMovie) {
    // Single unit: we only need an overall summary; chapters are generated per-unit below.
    const summaryPrompt = `Write a vivid, detailed overview (2-3 full paragraphs) of the movie "${input}" — its premise, the main characters, the overall arc of the plot, and its central themes — written so that a reader who has never seen it can picture what it is about and understand what happens. Output language: ${lang}. Output only the overview, with no preamble or heading.`;
    summary = (await chat(summaryPrompt)).trim();
    units = [input];
    cacheOutline(input, { summary, outline: units });
  } else {
    // TV: overall summary + the list of episodes (season mode) or story arcs.
    const segmentInstruction = season
      ? "Then list every episode of this season in chronological order, one per line. Use the episode's title (and episode number if helpful)."
      : "Then break the series down into its seasons or major story arcs in chronological order, one item per line.";
    const outlinePrompt = `Do two things for ${outlineSubject}. Output language: ${lang}.

1. First, write a vivid, detailed overview (2-3 full paragraphs) of the premise, the main characters, the overall plot arc, and the central themes, written so that a reader who has never seen it can picture what it is about and understand what happens.
2. ${segmentInstruction}

Output strictly in the following format, do not include other text:

===SUMMARY===
[summary content]

===OUTLINE===
[outline items, one per line]`;

    const outlineRaw = await chat(outlinePrompt);
    const summaryMatch = outlineRaw.match(
      /===SUMMARY===\s*([\s\S]*?)===OUTLINE===/,
    );
    const outlineMatch = outlineRaw.match(/===OUTLINE===\s*([\s\S]*)/);
    summary = summaryMatch ? summaryMatch[1].trim() : "";
    const outlineText = outlineMatch ? outlineMatch[1] : outlineRaw;
    units = outlineText
      .split("\n")
      .map((line) => line.replace(/^[-*•\d.]+\s*/, "").trim())
      .filter(
        (line) => line.length > 0 && !line.toLowerCase().includes("outline"),
      );

    cacheOutline(input, { summary, outline: units });
  }

  console.log(
    chalk.yellow(
      `🎬 Chapterizing ${units.length} ${unitPlural} (concurrency: ${concurrency})...`,
    ),
  );

  const results = new Array(units.length);
  let completed = 0;

  async function processUnit(i) {
    const unit = units[i];
    const cached = getCachedSection(input, i);
    if (cached) {
      results[i] = cached;
      completed++;
      console.log(
        chalk.gray(
          `   [${completed}/${units.length}] ${unit} ${chalk.cyan("(cached)")}`,
        ),
      );
      return;
    }

    const labels = getLabels(lang);
    const target = season
      ? `the episode "${unit}" from Season ${season.seasonNum} of the TV series "${season.show}"`
      : isMovie
        ? `the movie "${input}"`
        : `the ${unitName} "${unit}" from the TV series "${input}"`;

    // Shared chapter block format used for both movies and per-episode pruning.
    const chapterFormat = `## <short descriptive chapter title>

      ### ${labels.synopsis}
      [A vivid, detailed account of what happens in this chapter — written so that a reader who has never seen it can clearly picture the scenes in their mind. Walk through the events in chronological order: describe the setting and atmosphere, what each character does and says, their motivations and emotional states, the telling visual and dramatic details, and the key turning points and their consequences. Be generous with concrete specifics, and aim for several full paragraphs rather than a terse summary.]

      ### ${labels.highlights}
      - [Key plot point, theme, character moment, or insight]
      - ...

      ### ${labels.classicLines}
      > [The single most memorable line of dialogue from this chapter. Preserve the original wording. If exact quotes are uncertain, choose the most iconic, widely-recognized line. Quote dialogue in the work's original language; only if that language is neither English nor Chinese, translate it into Chinese instead.]
      >
      > [Another memorable line — each line of dialogue must be its own blockquote, separated by a blank "> " line as shown. Include every memorable, quotable line from the chapter; there is no upper limit, so err on the side of including more rather than fewer.]`;

    let rendered;
    if (multiUnit) {
      // Treat each episode / arc as a standalone "movie": its own summary + chapters.
      const unitPrompt = `
      Task: Treat ${target} as a standalone work and prune it like a movie. Output language: ${lang}. Spoilers are expected and encouraged — the goal is to fully understand the story without watching.

      1. First, write a vivid overview (1-2 full paragraphs) of ${target} — what it is about, who the key characters are, and the overall arc of what happens — written so that a reader who has never seen it can picture it and understand the story.
      2. Then break it into its Chapters — logical narrative segments / scenes in chronological order — repeating the chapter block below for each chapter, separating chapters with a line containing only ---.

      Output strictly in this format, nothing else:

      ===SUMMARY===
      [one paragraph]

      ===CHAPTERS===
      ${chapterFormat}

      Requirements:
      1. Divide it into roughly 4-8 chapters that follow the chronological flow.
      2. Give each chapter a short, descriptive title — do NOT prefix it with "Chapter N" or any numbering.
    `;

      const raw = await chat(unitPrompt);
      const summaryMatch = raw.match(/===SUMMARY===\s*([\s\S]*?)===CHAPTERS===/);
      const chaptersMatch = raw.match(/===CHAPTERS===\s*([\s\S]*)/);
      const unitSummary = summaryMatch ? summaryMatch[1].trim() : "";
      let chaptersText = (chaptersMatch ? chaptersMatch[1] : raw).trim();
      const headingPos = chaptersText.indexOf("## ");
      if (headingPos > 0) chaptersText = chaptersText.slice(headingPos);
      // Demote chapter headings one level so they sit under the unit heading.
      chaptersText = stripChapterPrefix(chaptersText)
        .replace(/^---+\s*\n*/, "")
        .replace(/\n*---+\s*$/, "")
        .replace(/^###/gm, "####")
        .replace(/^##(?!#)/gm, "###");

      rendered = `## ${unit}\n\n`;
      if (unitSummary) rendered += `${unitSummary}\n\n`;
      rendered += chaptersText;
    } else {
      // Movie: chapters at the top level; the overall summary sits at the document top.
      const chapterPrompt = `
      Task: Break ${target} down into its Chapters — logical narrative segments / scenes in chronological order. For EACH chapter, write a synopsis, highlights, and memorable lines. Output language: ${lang}. Spoilers are expected and encouraged — the goal is to fully understand the story without watching.

      Output strictly in this format, repeating the block for each chapter and separating chapters with a line containing only ---:

      ${chapterFormat}

      Requirements:
      1. Divide it into roughly 4-8 chapters that follow the chronological flow.
      2. Give each chapter a short, descriptive title — do NOT prefix it with "Chapter N" or any numbering.
      3. Output only the chapters in the format above, nothing else.
    `;

      let chaptersText = await chat(chapterPrompt);
      const headingPos = chaptersText.indexOf("## ");
      if (headingPos > 0) chaptersText = chaptersText.slice(headingPos);
      rendered = stripChapterPrefix(chaptersText)
        .trim()
        .replace(/^---+\s*\n*/, "")
        .replace(/\n*---+\s*$/, "");
    }

    results[i] = rendered;
    cacheSection(input, i, rendered);
    completed++;
    console.log(
      chalk.gray(
        `   [${completed}/${units.length}] ${unit} ${chalk.green("✓")}`,
      ),
    );
  }

  for (let i = 0; i < units.length; i += concurrency) {
    const batch = units
      .slice(i, i + concurrency)
      .map((_, j) => processUnit(i + j));
    await Promise.all(batch);
  }

  const labels = getLabels(lang);
  let fullResult = `# 《${input}》 ${labels.prunedSuffix}\n\n`;
  if (summary) fullResult += `${summary}\n\n`;
  fullResult += results.join("\n\n---\n\n");

  const qa = await generateQA(
    chat,
    input,
    null,
    batchSize,
    concurrency,
    lang,
    subject,
  );
  fullResult += qa;

  return fullResult;
}
