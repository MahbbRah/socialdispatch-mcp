---
name: socialdispatch-publish
description: Publish or schedule videos, images, or text posts directly to connected social media accounts (Facebook Pages, YouTube Channels, Instagram, TikTok, X) using the SocialDispatch MCP server. Use whenever the user asks to post, share, schedule, or upload content with socialdispatch.
---

# SocialDispatch Publishing & Scheduling Skill

Fast, single-step procedure for AI agents to publish or schedule content to connected social accounts (Facebook, YouTube, X, Instagram, TikTok) via the `socialdispatch` MCP server without unnecessary token burn or code inspection.

---

## 🔍 Discovering Your Social Connection IDs

To publish to any channel, the agent requires the `accountIds` (or `channelIds`). 

Call `list_social_connections`:
```json
{}
```
*Filter by platform if desired, e.g.:*
```json
{
  "platform": "youtube"
}
```

> **Tip:** You can maintain a local table of your frequent connection IDs here for fast lookup:
> 
> | Channel / Page Name | Platform | Connection ID |
> | :--- | :--- | :--- |
> | *My Main YouTube Channel* | `youtube` | `<YOUR_YOUTUBE_CONNECTION_ID>` |
> | *My Brand Facebook Page* | `facebook` | `<YOUR_FACEBOOK_CONNECTION_ID>` |
> | *My Company X Account* | `twitter` | `<YOUR_X_CONNECTION_ID>` |

---

## 1. Publishing YouTube Videos (Immediate or Scheduled)

YouTube uploads support dedicated metadata fields: **`title`**, **`content`** (video description), **`tags`**, **`thumbnailFile`**, and **`isShort`**.

### Immediate Publication
Call `publish_social_post`:
```json
{
  "accountIds": ["<YOUR_YOUTUBE_CONNECTION_ID>"],
  "title": "How AI Agents Work: 5 Agentic Design Patterns Explained",
  "content": "Full video description with links, chapters, and timestamps.",
  "mediaFiles": ["/absolute/path/to/video.mp4"],
  "thumbnailFile": "/absolute/path/to/thumbnail.jpg",
  "tags": ["AI agents", "agentic workflows", "LLMs"],
  "privacyStatus": "public",
  "isShort": false,
  "isAlteredContent": true
}
```

### Scheduled Publication
Call `schedule_social_post` with an ISO-8601 UTC timestamp (`scheduledAt`):
```json
{
  "accountIds": ["<YOUR_YOUTUBE_CONNECTION_ID>"],
  "title": "How AI Agents Work: 5 Agentic Design Patterns Explained",
  "content": "Full video description with links, chapters, and timestamps.",
  "mediaFiles": ["/absolute/path/to/video.mp4"],
  "thumbnailFile": "/absolute/path/to/thumbnail.jpg",
  "tags": ["AI agents", "agentic workflows", "LLMs"],
  "privacyStatus": "public",
  "isShort": false,
  "isAlteredContent": true,
  "scheduledAt": "2026-11-01T15:00:00.000Z"
}
```

### AI-Generated Content Compliance (`isAlteredContent`)
* `"isAlteredContent"` defaults to **`true`** for automated compliance across YouTube (`containsSyntheticMedia: true`), Facebook & Instagram (`is_ai_generated: true`), and TikTok (`is_aigc: true`).
* Explicitly pass `"isAlteredContent": false` only when the post contains purely authentic, unaltered human recordings.

### YouTube Shorts vs Regular Videos (`isShort`)
* Set `"isShort": true` to force YouTube Shorts handling (appends `#Shorts` and returns the `youtube.com/shorts/...` URL format).
* Set `"isShort": false` for standard horizontal long-form videos.
* If omitted, YouTube/SocialDispatch auto-detects based on vertical aspect ratio (height > width) or video duration ≤ 60 seconds.

### Smart Thumbnail Detection
If `thumbnailFile` is omitted but `mediaFiles` contains 1 video and 1 image (e.g. `["video.mp4", "cover.jpg"]`), SocialDispatch automatically attaches the image as the video's custom thumbnail.

---

## 2. Publishing to Facebook, Instagram, TikTok, or 𝕏 (Twitter)

For standard social posts, supply post copy in `content` and optional assets in `mediaFiles`:
```json
{
  "accountIds": ["<YOUR_FACEBOOK_OR_X_CONNECTION_ID>"],
  "content": "Exciting updates on our latest workflow release! Check out the details below. #Automation #Tech",
  "mediaFiles": ["/absolute/path/to/image.png"]
}
```

### Multi-Platform Dispatch
You can target multiple platforms simultaneously by passing multiple connection IDs:
```json
{
  "accountIds": [
    "<FACEBOOK_PAGE_CONNECTION_ID>",
    "<X_ACCOUNT_CONNECTION_ID>",
    "<INSTAGRAM_CONNECTION_ID>"
  ],
  "content": "One announcement across all social media channels! #Announcement"
}
```

---

## 3. Verifying Publication & Delivery Status

Always verify the status using `get_post_status` after publishing or scheduling:
```json
{
  "postId": "<postId returned from publish_social_post or schedule_social_post>"
}
```

* **Immediate Post**: Verify status is `PUBLISHED` and extract the platform live link (`externalPostId` / post URL).
* **Scheduled Post**: Verify status is `SCHEDULED` and confirm the `scheduledAt` timestamp.
