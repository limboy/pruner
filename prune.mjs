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

const program = new Command();

program
  .name('pruner')
  .description('Prune content from books or YouTube videos into a dense version.')
  .version('1.0.0')
  .argument('<input>', 'Book title or YouTube URL')
  .option('-o, --output <path>', 'Output directory or file path')
  .option('-b, --batch-size <number>', 'Number of sections per batch', process.env.SECTIONS_PER_BATCH || '3')
  .option('-c, --concurrency <number>', 'Number of parallel requests', process.env.CONCURRENCY || '3')
  .action(async (input, opts) => {
    const isYoutube = input.includes('youtube.com') || input.includes('youtu.be');
    const type = isYoutube ? 'youtube' : 'book';
    await handlePrune(type, input, opts.output, parseInt(opts.batchSize, 10), parseInt(opts.concurrency, 10));
  });

program.parse();

async function handlePrune(type, input, output, batchSize, concurrency) {
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
    }

    console.log(chalk.yellow('✂️  Starting multi-step pruning process...'));
    const pruned = await pruneContent(type, input, title, sourceContent, batchSize, concurrency);

    let outputPath;
    if (output) {
      if (output.endsWith('.md')) {
        outputPath = output;
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

function fetchYoutubeTranscript(url) {
  const tmpFile = resolve(__dirname, `.cache/_sub_${Date.now()}`);
  fs.mkdirSync(resolve(__dirname, '.cache'), { recursive: true });
  try {
    execFileSync('yt-dlp', [
      '--cookies-from-browser', 'chrome',
      '--js-runtimes', 'node',
      '--write-auto-sub', '--sub-lang', 'en', '--sub-format', 'json3',
      '--skip-download', '-o', tmpFile, url,
    ], { stdio: 'pipe' });
    const data = JSON.parse(fs.readFileSync(`${tmpFile}.en.json3`, 'utf-8'));
    return data.events
      .filter(e => e.segs)
      .map(e => e.segs.map(s => s.utf8).join(''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (error) {
    throw new Error(`Failed to fetch YouTube transcript: ${error.message}`);
  } finally {
    try { fs.unlinkSync(`${tmpFile}.en.json3`); } catch {}
  }
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

async function pruneContent(type, input, title, sourceContent, batchSize, concurrency) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error('API_KEY is missing in .env file');
  }

  const baseUrl = process.env.API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
  const modelName = process.env.MODEL || "gemini-1.5-pro";

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

  if (type === 'youtube') {
    return await pruneYoutube(chat, input, title, sourceContent, batchSize, concurrency);
  }
  return await pruneBook(chat, input, concurrency);
}

async function pruneYoutube(chat, input, title, sourceContent, batchSize, concurrency) {
  let summary = '';
  let outline = [];

  const cachedOutline = getCachedOutline(input);
  if (cachedOutline) {
    summary = cachedOutline.summary;
    outline = cachedOutline.outline;
    console.log(chalk.gray('   (loaded from cache)'));
  } else {
    const outlinePrompt = `请根据以下 YouTube 视频字幕内容，完成两件事。输出语言：中文。

1. 先用一段话(几百字)概括整个视频的核心内容和主旨。
2. 然后生成一个详细的内容大纲，将内容划分为逻辑清晰的模块，每行一个条目。

请严格按以下格式输出，不要包含其他文字：

===SUMMARY===
[概括内容]

===OUTLINE===
[大纲条目，每行一个]

字幕内容：
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
    const batchPrompt = `任务：根据以下视频字幕，为以下各部分分别提供"精简版（Pruned Version）"内容。输出语言：中文。

需要处理的部分：
${sectionList}

请对每个部分按以下格式输出：

## [部分标题]

### 内容精简
[该部分核心内容的高密度浓缩版本。删除所有的废话、重复点、订阅提醒等。保留所有的核心洞察、关键事实、情节转折或逻辑步骤。保持具体的细节，使其在不看原文的情况下依然能被深度理解。]

### 要点提炼
- [关键洞察、事实或核心情节 1]
- [关键洞察、事实或核心情节 2]
- ...

### 原文摘录
> [摘录该部分中最精彩、最有洞察力的原话，2-4段。保留说话者的原始措辞，不要改写。]

---

字幕内容：
${sourceContent}

要求：
1. 确保输出的信息密度足够大。
2. 即使不看视频，也能完全掌握每个部分讲述的关键点和细节。
3. 请按顺序逐个输出每个部分，每个部分之间用 --- 分隔。`;

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

  let fullResult = `# ${title} 精简版\n\n视频链接: ${input}\n\n`;
  if (summary) fullResult += `> ${summary}\n\n`;
  let combined = results.join('\n\n---\n\n');
  let sectionNum = 0;
  combined = combined.replace(/^## \d+[\.\、．]\s*/gm, () => `## ${++sectionNum}. `);
  fullResult += combined;
  return fullResult;
}

async function pruneBook(chat, input, concurrency) {
  let summary = '';
  let outline = [];

  const cachedOutline = getCachedOutline(input);
  if (cachedOutline) {
    summary = cachedOutline.summary;
    outline = cachedOutline.outline;
    console.log(chalk.gray('   (loaded from cache)'));
  } else {
    const outlinePrompt = `请为书籍《${input}》完成两件事。输出语言：中文。

1. 先用一段话(几百字)概括这本书的核心内容和主旨。
2. 然后生成一个详细的章节或主题大纲，每行一个条目。

请严格按以下格式输出，不要包含其他文字：

===SUMMARY===
[概括内容]

===OUTLINE===
[大纲条目，每行一个]`;

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

    const sectionPrompt = `
      任务：请为书籍《${input}》中的章节/主题"${section}"提供"精简版（Pruned Version）"内容。输出语言：中文。

      格式要求：
      ## ${section}

      ### 内容精简
      [在此处提供该部分核心内容的高密度压缩版本。无论是情节转折、人物发展还是核心理论、逻辑链条，都请提供深度的浓缩。删除所有冗余修饰，但保留支撑内容质感的核心细节和关键案例/场景，使其在不看原著的情况下依然能获得实质性的阅读体验。]

      ### 要点提炼
      - [核心点、关键情节、核心洞察或逻辑逻辑点 1]
      - [核心点、关键情节、核心洞察或逻辑逻辑点 2]
      - ...

      ### 原文摘录
      > [摘录该章节中最精彩、最有洞察力或最具代表性的原文段落，2-4段。保留原文措辞，不要改写。]

      要求：
      1. 这不是简单的摘要，而是对原著内容的高密度重构。
      2. 每一句话都应该具有极高的信息量。
      3. 即使读者不看原著，也能通过这份内容获得接近原著的知识量或情节体验。
      4. 原文摘录必须是书中的原话，选择最能体现该章节精髓的段落。
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

  let fullResult = `# 《${input}》 精简版\n\n`;
  if (summary) fullResult += `> ${summary}\n\n`;
  fullResult += results.join('\n\n---\n\n');

  return fullResult;
}
