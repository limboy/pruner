#!/usr/bin/env node

import { Command } from 'commander';
import { YoutubeTranscript } from 'youtube-transcript';
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

const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10);
const CACHE_DIR = resolve(__dirname, '.cache');

const program = new Command();

program
  .name('pruner')
  .description('Prune content from books or YouTube videos into a dense version.')
  .version('1.0.0')
  .argument('<input>', 'Book title or YouTube URL')
  .option('-o, --output <path>', 'Output directory or file path')
  .action(async (input, opts) => {
    const isYoutube = input.includes('youtube.com') || input.includes('youtu.be');
    const type = isYoutube ? 'youtube' : 'book';
    await handlePrune(type, input, opts.output);
  });

program.parse();

async function handlePrune(type, input, output) {
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
    const pruned = await pruneContent(type, input, title, sourceContent);

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

async function fetchYoutubeTranscript(url) {
  try {
    const transcripts = await YoutubeTranscript.fetchTranscript(url);
    return transcripts.map(t => t.text).join(' ');
  } catch (error) {
    throw new Error(`Failed to fetch YouTube transcript: ${error.message}`);
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

function cleanCache(input) {
  try {
    const prefix = cacheKey(input);
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (f.startsWith(prefix)) fs.unlinkSync(resolve(CACHE_DIR, f));
    }
    if (fs.readdirSync(CACHE_DIR).length === 0) fs.rmdirSync(CACHE_DIR);
  } catch {}
}

async function pruneContent(type, input, title, sourceContent) {
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

  console.log(chalk.yellow('📝 Generating content outline...'));

  let outlinePrompt = '';
  if (type === 'book') {
    outlinePrompt = `请为书籍《${input}》生成一个详细的章节或主题大纲。请直接以列表形式列出大纲条目，每行一个。不要包含任何前导语或总结性文字。`;
  } else {
    outlinePrompt = `请根据以下 YouTube 视频字幕内容生成一个详细的内容大纲。请将内容划分为逻辑清晰的模块。直接以列表形式列出条目，每行一个。不要包含任何前导语或总结性文字。\n\n字幕内容：\n${sourceContent}`;
  }

  const outlineRaw = await chat(outlinePrompt);
  const outline = outlineRaw.split('\n')
    .map(line => line.replace(/^[-*•\d.]+\s*/, '').trim())
    .filter(line => line.length > 0 && !line.toLowerCase().includes('outline'));

  console.log(chalk.yellow(`📖 Found ${outline.length} sections. Generating dense content (concurrency: ${CONCURRENCY})...`));

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

    let sectionPrompt = '';
    if (type === 'book') {
      sectionPrompt = `
        任务：请为书籍《${input}》中的章节/主题"${section}"提供"精简版（Pruned Version）"内容。输出语言：中文。

        格式要求：
        ## ${section}

        ### 内容精简
        [在此处提供该部分核心内容的高密度压缩版本。无论是情节转折、人物发展还是核心理论、逻辑链条，都请提供深度的浓缩。删除所有冗余修饰，但保留支撑内容质感的核心细节和关键案例/场景，使其在不看原著的情况下依然能获得实质性的阅读体验。]

        ### 要点提炼
        - [核心点、关键情节、核心洞察或逻辑逻辑点 1]
        - [核心点、关键情节、核心洞察或逻辑逻辑点 2]
        - ...

        要求：
        1. 这不是简单的摘要，而是对原著内容的高密度重构。
        2. 每一句话都应该具有极高的信息量。
        3. 即使读者不看原著，也能通过这份内容获得接近原著的知识量或情节体验。
      `;
    } else {
      sectionPrompt = `
        任务：根据以下视频字幕，为其中的部分"${section}"提供"精简版（Pruned Version）"内容。输出语言：中文。

        格式要求：
        ## ${section}

        ### 内容精简
        [在此处提供该部分核心内容的高密度浓缩版本。删除所有的废话、重复点、订阅提醒等。保留所有的核心洞察、关键事实、情节转折或逻辑步骤。保持具体的细节，使其在不看原文的情况下依然能被深度理解。]

        ### 要点提炼
        - [关键洞察、事实或核心情节 1]
        - [关键洞察、事实或核心情节 2]
        - ...

        字幕内容供参考：
        ---
        ${sourceContent}
        ---

        要求：
        1. 确保输出的信息密度足够大。
        2. 即使不看视频，也能完全掌握该部分讲述的关键点和细节。
      `;
    }

    const sectionText = await chat(sectionPrompt);
    results[i] = sectionText;
    cacheSection(input, i, sectionText);
    completed++;
    console.log(chalk.gray(`   [${completed}/${outline.length}] ${section} ${chalk.green('✓')}`));
  }

  // Process sections concurrently with limited parallelism
  for (let i = 0; i < outline.length; i += CONCURRENCY) {
    const batch = outline.slice(i, i + CONCURRENCY).map((_, j) => processSection(i + j));
    await Promise.all(batch);
  }

  let fullResult = `# ${type === 'book' ? `《${input}》` : title} 精简版\n\n`;
  if (type === 'youtube') fullResult += `视频链接: ${input}\n\n`;
  fullResult += results.join('\n\n---\n\n');

  return fullResult;
}
