# SocialDispatch Model Context Protocol (MCP) Server

[![MCP](https://img.shields.io/badge/MCP-Protocol%20v1.0-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)

The official **Model Context Protocol (MCP)** server for [SocialDispatch](https://socialdispatch.site).

Connects AI coding assistants and autonomous agents (such as **Claude Desktop**, **Google Antigravity**, **Cursor**, **Windsurf**, and **Cline**) directly to your social media accounts. Let AI agents manage, generate, schedule, and publish content across **Facebook Pages, YouTube, TikTok, Instagram, and X (Twitter)**.

---

## ⚡ Quickstart

### Prerequisites
1. **SocialDispatch Account**: Sign up at [socialdispatch.site](https://socialdispatch.site) and connect your social profiles.
2. **API Key**: Generate an API key from your workspace settings (starts with `sd_live_...`).
3. **Node.js**: `v18.0.0` or higher.

---

## 🛠️ Client Configuration

### 1. Claude Desktop
Add the following to your configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "socialdispatch": {
      "command": "npx",
      "args": ["-y", "@socialdispatch/mcp-server"],
      "env": {
        "SOCIALDISPATCH_API_URL": "https://api.socialdispatch.site",
        "SOCIALDISPATCH_API_KEY": "sd_live_YOUR_API_KEY_HERE"
      }
    }
  }
}
```

> **Tip:** You can also run directly from GitHub without installing:
> ```json
> "args": ["-y", "github:MahbbRah/socialdispatch-mcp"]
> ```

---

### 2. Google Antigravity / Gemini CLI
Add to `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "socialdispatch": {
      "command": "npx",
      "args": ["-y", "@socialdispatch/mcp-server"],
      "env": {
        "SOCIALDISPATCH_API_URL": "https://api.socialdispatch.site",
        "SOCIALDISPATCH_API_KEY": "sd_live_YOUR_API_KEY_HERE"
      }
    }
  }
}
```

---

### 3. Cursor & Windsurf
Add to `.cursor/mcp.json` or your MCP Settings pane:

```json
{
  "mcpServers": {
    "socialdispatch": {
      "command": "npx",
      "args": ["-y", "@socialdispatch/mcp-server"],
      "env": {
        "SOCIALDISPATCH_API_URL": "https://api.socialdispatch.site",
        "SOCIALDISPATCH_API_KEY": "sd_live_YOUR_API_KEY_HERE"
      }
    }
  }
}
```

---

## 🧰 Available Tools (14 Tools)

### 🚀 Publishing & Scheduling

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| **`list_social_connections`** | *(none)* | Returns connected accounts (Facebook Pages, YouTube, TikTok, Instagram, X) with channel IDs, account names, and connection status. |
| **`generate_social_content`** | `topicPrompt`, `targetPlatforms`, `tone` | Uses the SocialDispatch copywriting engine to write platform-optimized copy with appropriate hashtags and character limits. |
| **`upload_media`** | `filePath` | Uploads local images (`png`, `jpg`, `webp`) or videos (`mp4`, `mov`) to SocialDispatch storage. Returns the CDN URL. |
| **`publish_social_post`** | `channelIds`, `content`, `mediaUrls`, `videoThumbnailUrl` | Immediately publishes to one or more connected channels with media attachments and custom video thumbnails. |
| **`schedule_social_post`** | `channelIds`, `content`, `scheduledFor`, `mediaUrls`, `videoThumbnailUrl` | Schedules a post for a specific ISO-8601 UTC timestamp or the next optimal posting slot. |
| **`generate_and_publish_post`** | `topicPrompt`, `channelIds`, `scheduleTime` | One-shot tool: drafts tailored copy for the target channels and automatically publishes or schedules. |
| **`get_post_status`** | `postId` | Fetches live publishing status, platform post links, and platform-specific error messages. |
| **`list_recent_posts`** | `limit`, `channelId` | Retrieves recent posts, scheduled queues, and execution history. |
| **`update_social_post`** | `postId`, `content`, `scheduledFor` | Edits copy or reschedules a pending queued post. |
| **`delete_social_post`** | `postId` | Cancels and permanently deletes a scheduled post. |

---

### 💡 Content Pipeline & Workflow

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| **`add_content_ideas`** | `ideas` *(title, notes, platforms)* | Adds brainstorming ideas into your team's content ideation backlog. |
| **`list_content_pipeline`** | `stage`, `limit` | Queries items in the production pipeline across stages: `IDEA`, `SCRIPT`, `FOOTAGE`, `EDITING`, `REVIEW`, `SCHEDULED`. |
| **`update_content_progress`** | `itemId`, `stage`, `notes`, `mediaUrls` | Transitions an item forward in the pipeline with updated assets or review notes. |
| **`get_next_pipeline_item`** | `stage` | Picks up the highest-priority item ready for the next creation step. |

---

## 💻 Local Development & Contributing

### 1. Clone & Install
```bash
git clone https://github.com/MahbbRah/socialdispatch-mcp.git
cd socialdispatch-mcp

npm install
```

### 2. Build TypeScript
```bash
npm run build
```

### 3. Run Dev Server with Live Reload
```bash
export SOCIALDISPATCH_API_URL="https://api.socialdispatch.site"
export SOCIALDISPATCH_API_KEY="sd_live_..."

npm run dev
```

### 4. Test via MCP Inspector
You can inspect and debug the tools interactively using the official MCP inspector:
```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).
