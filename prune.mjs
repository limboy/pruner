#!/usr/bin/env node

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import chalk from 'chalk';
import fs from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '.env');
try {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {}

const CACHE_DIR = resolve(__dirname, '.cache');

const LANG_MAP = {
  zh: 'Chinese', cn: 'Chinese', chinese: 'Chinese', 中文: 'Chinese',
  en: 'English', english: 'English',
  ja: 'Japanese', jp: 'Japanese', japanese: 'Japanese',
  ko: 'Korean', kr: 'Korean', korean: 'Korean',
  fr: 'French', french: 'French',
  de: 'German', german: 'German',
  es: 'Spanish', spanish: 'Spanish',
  pt: 'Portuguese', portuguese: 'Portuguese',
  ru: 'Russian', russian: 'Russian',
  ar: 'Arabic', arabic: 'Arabic',
};

function resolveLang(lang) {
  return LANG_MAP[lang.toLowerCase()] || lang;
}

function getLabels(lang) {
  const resolved = resolveLang(lang);
  const isChinese = resolved === 'Chinese';
  return isChinese ? {
    prunedSuffix: '精简版',
    videoLink: '视频链接',
    articleLink: '原文链接',
    contentPrune: '内容精简',
    keyPoints: '要点提炼',
    excerpts: '原文摘录',
  } : {
    prunedSuffix: 'Pruned Version',
    videoLink: 'Video',
    articleLink: 'Source',
    contentPrune: 'Dense Reconstruction',
    keyPoints: 'Key Takeaways',
    excerpts: 'Original Excerpts',
  };
}

const program = new Command();

program
  .name('pruner')
  .description('Prune content from books or YouTube videos into a dense version.')
  .version('1.0.0')
  .argument('<input>', 'Book title or YouTube URL')
  .option('-o, --output <path>', 'Output directory or file path')
  .option('-b, --batch-size <number>', 'Number of sections per batch', process.env.SECTIONS_PER_BATCH || '3')
  .option('-c, --concurrency <number>', 'Number of parallel requests', process.env.CONCURRENCY || '3')
  .option('-l, --lang <language>', 'Output language', process.env.OUTPUT_LANG || 'Chinese')
  .action(async (input, opts) => {
    let type = 'book';
    if (input.startsWith('http://') || input.startsWith('https://')) {
      if (input.includes('youtube.com') || input.includes('youtu.be')) {
        type = 'youtube';
      } else {
        type = 'url';
      }
    }
    await handlePrune(type, input, opts.output, parseInt(opts.batchSize, 10), parseInt(opts.concurrency, 10), opts.lang);
  });

program.parse();

async function handlePrune(type, input, output, batchSize, concurrency, lang) {
  lang = resolveLang(lang);
  try {
    console.log(chalk.blue(`\n🚀 Processing ${type}: ${chalk.bold(input)}...`));

    let sourceContent = '';
    let title = input;

    if (type === 'youtube') {
      sourceContent = await fetchYoutubeTranscript(input);
      if (!sourceContent) {
        throw new Error('Could not retrieve YouTube transcript.');
      }
      title = await fetchYoutubeTitle(input);
    } else if (type === 'url') {
      const parsed = await fetchUrlContent(input);
      sourceContent = parsed.content;
      if (!sourceContent) {
        throw new Error('Could not retrieve content from URL.');
      }
      title = parsed.title;
    }

    console.log(chalk.yellow('✂️  Starting multi-step pruning process...'));
    const pruned = await pruneContent(type, input, title, sourceContent, batchSize, concurrency, lang);

    let outputPath;
    if (output) {
      if (output.endsWith('.md')) {
        outputPath = output;
        const parentDir = dirname(outputPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
      } else {
        fs.mkdirSync(output, { recursive: true });
        outputPath = resolve(output, `${title}.md`);
      }
    } else {
      outputPath = `${title}.md`;
    }
    fs.writeFileSync(outputPath, pruned);
    cleanCache(input);

    console.log(chalk.green(`\n✅ Done! Pruned version saved to: ${chalk.bold(outputPath)}`));

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
  return url.match(/(?:v=|youtu\.be\/)([^&]+)/)?.[1] || 'video';
}

async function fetchUrlContent(url) {
  try {
    const output = execFileSync('npx', ['defuddle', 'parse', url, '--json'], { encoding: 'utf-8' });
    const data = JSON.parse(output);
    return {
      content: data.contentMarkdown,
      title: data.title || url
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
    execFileSync('yt-dlp', [
      '--cookies-from-browser', 'chrome',
      '--js-runtimes', 'node',
      '--write-auto-sub', '--sub-lang', 'en', '--sub-format', 'json3',
      '--skip-download', '-o', tmpFile, url,
    ], { stdio: 'pipe' });

    // yt-dlp may download as .json3 or .vtt depending on version/availability
    foundFiles = fs.readdirSync(CACHE_DIR)
      .filter(f => f.startsWith(tmpBase) && (f.endsWith('.json3') || f.endsWith('.vtt')));

    if (foundFiles.length === 0) {
      throw new Error('No subtitle file was downloaded by yt-dlp.');
    }

    const subFile = resolve(CACHE_DIR, foundFiles[0]);
    const raw = fs.readFileSync(subFile, 'utf-8');

    if (subFile.endsWith('.json3')) {
      const data = JSON.parse(raw);
      return data.events
        .filter(e => e.segs)
        .map(e => e.segs.map(s => s.utf8).join(''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Parse VTT format
    return parseVtt(raw);
  } catch (error) {
    throw new Error(`Failed to fetch YouTube transcript: ${error.message}`);
  } finally {
    for (const f of foundFiles) {
      try { fs.unlinkSync(resolve(CACHE_DIR, f)); } catch {}
    }
  }
}

function parseVtt(vttContent) {
  const lines = vttContent.split('\n');
  const textLines = [];
  const seen = new Set();
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip headers, timestamps, and empty lines
    if (!trimmed || trimmed === 'WEBVTT' || trimmed.startsWith('Kind:') ||
        trimmed.startsWith('Language:') || trimmed.includes(' --> ')) continue;
    // Remove VTT tags like <c> </c> and speaker tags like <v Name>
    const cleaned = trimmed.replace(/<[^>]+>/g, '').trim();
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      textLines.push(cleaned);
    }
  }
  return textLines.join(' ').replace(/\s+/g, ' ').trim();
}

function cacheKey(input) {
  return input.replace(/[^a-z0-9一-鿿]/gi, '_');
}

function getCachedSection(input, index) {
  try {
    return fs.readFileSync(resolve(CACHE_DIR, `${cacheKey(input)}_${index}.md`), 'utf-8');
  } catch { return null; }
}

function cacheSection(input, index, content) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(resolve(CACHE_DIR, `${cacheKey(input)}_${index}.md`), content);
}

function getCachedOutline(input) {
  try {
    return JSON.parse(fs.readFileSync(resolve(CACHE_DIR, `${cacheKey(input)}_outline.json`), 'utf-8'));
  } catch { return null; }
}

function cacheOutline(input, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(resolve(CACHE_DIR, `${cacheKey(input)}_outline.json`), JSON.stringify(data));
}

function cleanCache(input) {
  try {
    const prefix = cacheKey(input);
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (f.startsWith(prefix)) fs.unlinkSync(resolve(CACHE_DIR, f));
    }
    if (fs.readdirSync(CACHE_DIR).length === 0) fs.rmdirSync(CACHE_DIR);
  } catch {}
}

async function pruneContent(type, input, title, sourceContent, batchSize, concurrency, lang) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error('API_KEY is missing in .env file');
  }

  const baseUrl = process.env.API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
  const modelName = process.env.MODEL || "gemini-3-flash-preview";

  async function chat(prompt) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelName, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  }

  if (type === 'youtube' || type === 'url') {
    return await pruneGenericContent(chat, type, input, title, sourceContent, batchSize, concurrency, lang);
  }
  return await pruneBook(chat, input, concurrency, lang);
}


async function pruneGenericContent(chat, type, input, title, sourceContent, batchSize, concurrency, lang) {
  let summary = '';
  let outline = [];

  const cachedOutline = getCachedOutline(input);
  if (cachedOutline) {
    summary = cachedOutline.summary;
    outline = cachedOutline.outline;
    console.log(chalk.gray('   (loaded from cache)'));
  } else {
    const contentType = type === 'youtube' ? 'YouTube video transcript' : 'web article';
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
    const summaryMatch = outlineRaw.match(/===SUMMARY===\s*([\s\S]*?)===OUTLINE===/);
    const outlineMatch = outlineRaw.match(/===OUTLINE===\s*([\s\S]*)/);
    summary = summaryMatch ? summaryMatch[1].trim() : '';
    const outlineText = outlineMatch ? outlineMatch[1] : outlineRaw;
    outline = outlineText.split('\n')
      .map(line => line.replace(/^[-*•\d.]+\s*/, '').trim())
      .filter(line => line.length > 0 && !line.toLowerCase().includes('outline'));

    cacheOutline(input, { summary, outline });
  }

  const SECTIONS_PER_BATCH = batchSize;
  const batches = [];
  for (let i = 0; i < outline.length; i += SECTIONS_PER_BATCH) {
    batches.push(outline.slice(i, i + SECTIONS_PER_BATCH));
  }

  console.log(chalk.yellow(`📖 Found ${outline.length} sections in ${batches.length} batches. Generating dense content (concurrency: ${concurrency})...`));

  const results = new Array(batches.length);
  let completed = 0;

  async function processBatch(batchIndex) {
    const sections = batches[batchIndex];
    const cached = getCachedSection(input, batchIndex);
    if (cached) {
      results[batchIndex] = cached;
      completed++;
      console.log(chalk.gray(`   [${completed}/${batches.length}] Batch ${batchIndex + 1} (${sections.length} sections) ${chalk.cyan('(cached)')}`));
      return;
    }

    const sectionList = sections.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const labels = getLabels(lang);
    const contentType = type === 'youtube' ? 'video transcript' : 'article content';
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
> [Extract the most brilliant and insightful original quotes from this section, 2-4 passages. Preserve original wording, do not rewrite.]

---

Content:
${sourceContent}

Requirements:
1. Ensure the output has sufficiently high information density.
2. Even without reading the original, one should fully grasp the key points and details of each section.
3. Output each section in order, separated by ---.`;

    let batchText = await chat(batchPrompt);
    const firstHeading = batchText.indexOf('## ');
    if (firstHeading > 0) batchText = batchText.slice(firstHeading);
    
    // Trim and remove leading/trailing separators to avoid double HRs when joining
    batchText = batchText.trim().replace(/^---+\s*\n*/, '').replace(/\n*---+\s*$/, '');
    
    results[batchIndex] = batchText;
    cacheSection(input, batchIndex, batchText);
    completed++;
    console.log(chalk.gray(`   [${completed}/${batches.length}] Batch ${batchIndex + 1} (${sections.length} sections) ${chalk.green('✓')}`));
  }

  for (let i = 0; i < batches.length; i += concurrency) {
    const batch = batches.slice(i, i + concurrency).map((_, j) => processBatch(i + j));
    await Promise.all(batch);
  }

  const labels = getLabels(lang);
  const sourceLink = type === 'youtube' ? `${labels.videoLink}: ${input}` : `${labels.articleLink}: ${input}`;
  let fullResult = `# ${title} ${labels.prunedSuffix}\n\n${sourceLink}\n\n`;
  if (summary) fullResult += `> ${summary}\n\n`;
  let combined = results.join('\n\n---\n\n');
  let sectionNum = 0;
  combined = combined.replace(/^## \d+[\.\、．]\s*/gm, () => `## ${++sectionNum}. `);
  fullResult += combined;
  return fullResult;
}

async function pruneBook(chat, input, concurrency, lang) {
  let summary = '';
  let outline = [];

  const cachedOutline = getCachedOutline(input);
  if (cachedOutline) {
    summary = cachedOutline.summary;
    outline = cachedOutline.outline;
    console.log(chalk.gray('   (loaded from cache)'));
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
    const summaryMatch = outlineRaw.match(/===SUMMARY===\s*([\s\S]*?)===OUTLINE===/);
    const outlineMatch = outlineRaw.match(/===OUTLINE===\s*([\s\S]*)/);
    summary = summaryMatch ? summaryMatch[1].trim() : '';
    const outlineText = outlineMatch ? outlineMatch[1] : outlineRaw;
    outline = outlineText.split('\n')
      .map(line => line.replace(/^[-*•\d.]+\s*/, '').trim())
      .filter(line => line.length > 0 && !line.toLowerCase().includes('outline'));

    cacheOutline(input, { summary, outline });
  }

  console.log(chalk.yellow(`📖 Found ${outline.length} sections. Generating dense content (concurrency: ${concurrency})...`));

  const results = new Array(outline.length);
  let completed = 0;

  async function processSection(i) {
    const section = outline[i];
    const cached = getCachedSection(input, i);
    if (cached) {
      results[i] = cached;
      completed++;
      console.log(chalk.gray(`   [${completed}/${outline.length}] ${section} ${chalk.cyan('(cached)')}`));
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
      > [Extract the most brilliant, insightful, or representative original passages from this chapter, 2-4 passages. Preserve original wording, do not rewrite.]

      Requirements:
      1. This is not a simple summary, but a high-density reconstruction of the original content.
      2. Every sentence should carry extremely high information density.
      3. Even without reading the original, readers should gain knowledge or plot experience close to the original.
      4. Original excerpts must be actual quotes from the book, choosing passages that best embody the chapter's essence.
    `;

    let sectionText = await chat(sectionPrompt);
    const headingPos = sectionText.indexOf('## ');
    if (headingPos > 0) sectionText = sectionText.slice(headingPos);

    // Trim and remove leading/trailing separators to avoid double HRs when joining
    sectionText = sectionText.trim().replace(/^---+\s*\n*/, '').replace(/\n*---+\s*$/, '');

    results[i] = sectionText;
    cacheSection(input, i, sectionText);
    completed++;
    console.log(chalk.gray(`   [${completed}/${outline.length}] ${section} ${chalk.green('✓')}`));
  }

  for (let i = 0; i < outline.length; i += concurrency) {
    const batch = outline.slice(i, i + concurrency).map((_, j) => processSection(i + j));
    await Promise.all(batch);
  }

  const labels = getLabels(lang);
  let fullResult = `# 《${input}》 ${labels.prunedSuffix}\n\n`;
  if (summary) fullResult += `> ${summary}\n\n`;
  fullResult += results.join('\n\n---\n\n');

  return fullResult;
}
