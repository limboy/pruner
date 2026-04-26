# Pruner ✂️

A tool to turn books and YouTube videos into **dense, pruned** versions. Not a summary, but a concentrated extraction of knowledge using a multi-step process for maximum detail.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file and add your Gemini API key:
   ```env
   GEMINI_API_KEY=your_gemini_api_key
   ```

## Usage

### 📖 Prune a Book
Provide the book title. The tool will generate a detailed outline and then prune each section one by one.
```bash
node prune.mjs book "Thinking, Fast and Slow"
```

### 📺 Prune a YouTube Video
Fetches the transcript, generates a logical outline, and prunes each segment.
```bash
node prune.mjs youtube "https://www.youtube.com/watch?v=VIDEO_ID"
```

## How it works

1. **Step 1: Outline Generation**: The LLM analyzes the book (based on knowledge) or video (based on transcript) to create a detailed outline.
2. **Step 2: Section Pruning**: For each section in the outline, the LLM generates a dense reconstruction (`内容精简`) and key takeaways (`要点提炼`).

This multi-step approach ensures that even long content is processed with high detail and doesn't get "watered down" by context window limits.

The output is saved as a `.md` file in the current directory.
