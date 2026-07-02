# Pruner ✂️

A tool to turn books, YouTube videos, **web articles**, and **local markdown files** into **dense, pruned** versions. Not a summary, but a concentrated extraction of knowledge using a multi-step process for maximum detail.

## Setup

1. **Prerequisites**:
   - Node.js installed.
   - [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed (optional, only required for YouTube transcripts).
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configuration**:
   Create a `.env` file and add your API details:
   ```env
   API_KEY=your_api_key
   API_BASE_URL=https://openrouter.ai/api/v1 (defaults to OpenRouter)
   MODEL=deepseek/deepseek-v4-flash (defaults to deepseek/deepseek-v4-flash)
   SECTIONS_PER_BATCH=3 (optional, default: 3)
   CONCURRENCY=3 (optional, default: 3)
   OUTPUT_LANG=Chinese (optional, default: Chinese)
   ```

## Usage

The tool automatically detects whether the input is a book title, a YouTube URL, a web article URL, or a local `.md` file.

### 📖 Prune a Book
```bash
node prune.mjs "Thinking, Fast and Slow"
```

### 📺 Prune a YouTube Video
```bash
node prune.mjs "https://www.youtube.com/watch?v=VIDEO_ID"
```

### 🌐 Prune a Web Article
```bash
node prune.mjs "https://example.com/interesting-article"
```

### 📄 Prune a Local Markdown File
```bash
node prune.mjs "./my-document.md"
```

### 🎬 Prune a Movie or TV Series
Plain titles auto-detect as books, so use `--type` to force a movie or TV series.
The output is built from the LLM's internal knowledge (no source is fetched).
Each unit is subdivided into **Chapters**, and every chapter gets a **简介
(Synopsis)**, **看点提炼 (Highlights)**, and **经典台词 (Memorable Lines)**.
**Spoilers are expected.**
```bash
node prune.mjs "Inception" --type movie
node prune.mjs "Breaking Bad" --type tv
```

A **movie** is broken straight into chapters:
```
# 《Inception》 精简版
## Chapter 1: ...
### 简介 / ### 看点提炼 / ### 经典台词
```

**Per-episode mode:** add a season specifier (`S01`, `S2`, `Season 1`, …) to a TV
title and each **episode** of that season is pruned independently — like its own
standalone movie (an episode summary plus chapters) — and the episodes are then
combined into a single document:
```bash
node prune.mjs "Chernobyl S01" --type tv
node prune.mjs "Breaking Bad Season 1" --type tv
```
```
# 《Chernobyl S01》 精简版
season summary
## 第1集：1:23:45            (episode)
episode summary
### Chapter 1: ...           (chapter)
#### 简介 / #### 看点提炼 / #### 经典台词
```
Without a season specifier, the series is split into seasons / major story arcs
(each pruned the same way) instead.

### 🛠️ Options
- `-o, --output <path>`: Specify output directory or file path.
- `-b, --batch-size <number>`: Number of sections per batch (for YouTube and web articles).
- `-c, --concurrency <number>`: Number of parallel requests to the LLM.
- `-l, --lang <language>`: Output language (default: `Chinese`). Supports abbreviations: `en`, `zh`, `ja`, `ko`, `fr`, `de`, `es`, `pt`, `ru`, `ar`, or full names like `English`, `Japanese`, etc.
- `-t, --type <type>`: Force the input type, overriding auto-detection. Accepts `book`, `tv` (TV series), or `movie`. Required for movies/TV series since plain titles otherwise default to `book`.

## How it works

1. **Extraction**: 
   - **Books**: Relies on LLM internal knowledge.
   - **YouTube**: Fetches transcripts using `yt-dlp`.
   - **Web Articles**: Extracts clean content using [defuddle](https://github.com/kepano/defuddle).
   - **Local Markdown**: Reads the contents of the local `.md` file directly.
2. **Step 1: Outline Generation**: The LLM analyzes the source content to create a detailed logical outline.
3. **Step 2: Section Pruning**: For each section in the outline, the LLM generates:
   - **内容精简 (Dense Reconstruction)**: A high-density version of the core content.
   - **要点提炼 (Key Takeaways)**: Bullet points of key insights.
   - **原文摘录 (Original Excerpts)**: Direct quotes from the source for context.

### Features
- **Automatic Type Detection**: Handles books, videos, articles, and local markdown files seamlessly.
- **Parallel Processing**: Uses concurrency to speed up the pruning process.
- **Resumable Caching**: Results are cached in `.cache/`, allowing you to resume if interrupted.
- **Smart Formatting**: Combines results into a single, well-formatted Markdown file.

The output is saved as a `.md` file in the current directory or specified output path.
