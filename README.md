# Pruner ✂️

A tool to turn books, YouTube videos, and **web articles** into **dense, pruned** versions. Not a summary, but a concentrated extraction of knowledge using a multi-step process for maximum detail.

## Setup

1. **Prerequisites**:
   - Node.js installed.
   - [yt-dlp](https://github.com/yt-dlp/yt-dlp) installed (required for YouTube transcripts).
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Configuration**:
   Create a `.env` file and add your API details:
   ```env
   API_KEY=your_api_key
   API_BASE_URL=https://... (optional, defaults to Gemini API)
   MODEL=... (optional, defaults to gemini-3-flash-preview)
   SECTIONS_PER_BATCH=3 (optional, default: 3)
   CONCURRENCY=3 (optional, default: 3)
   ```

## Usage

The tool automatically detects whether the input is a book title, a YouTube URL, or a web article URL.

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

### 🛠️ Options
- `-o, --output <path>`: Specify output directory or file path.
- `-b, --batch-size <number>`: Number of sections per batch (for YouTube and web articles).
- `-c, --concurrency <number>`: Number of parallel requests to the LLM.

## How it works

1. **Extraction**: 
   - **Books**: Relies on LLM internal knowledge.
   - **YouTube**: Fetches transcripts using `yt-dlp`.
   - **Web Articles**: Extracts clean content using [defuddle](https://github.com/kepano/defuddle).
2. **Step 1: Outline Generation**: The LLM analyzes the source content to create a detailed logical outline.
3. **Step 2: Section Pruning**: For each section in the outline, the LLM generates:
   - **内容精简 (Dense Reconstruction)**: A high-density version of the core content.
   - **要点提炼 (Key Takeaways)**: Bullet points of key insights.
   - **原文摘录 (Original Excerpts)**: Direct quotes from the source for context.

### Features
- **Automatic Type Detection**: Handles books, videos, and articles seamlessly.
- **Parallel Processing**: Uses concurrency to speed up the pruning process.
- **Resumable Caching**: Results are cached in `.cache/`, allowing you to resume if interrupted.
- **Smart Formatting**: Combines results into a single, well-formatted Markdown file.

The output is saved as a `.md` file in the current directory or specified output path.
