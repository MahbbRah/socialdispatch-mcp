#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
import FormData from 'form-data';
dotenv.config();
const API_BASE_URL = (process.env.SOCIALDISPATCH_API_URL || 'https://api.socialdispatch.site').replace(/\/+$/, '');
const API_KEY = process.env.SOCIALDISPATCH_API_KEY || '';
const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        ...(API_KEY
            ? {
                'x-api-key': API_KEY,
                Authorization: `Bearer ${API_KEY}`,
            }
            : {}),
    },
    timeout: 45000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
});
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.png':
            return 'image/png';
        case '.webp':
            return 'image/webp';
        case '.gif':
            return 'image/gif';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.mp4':
        case '.m4v':
            return 'video/mp4';
        case '.mov':
            return 'video/quicktime';
        case '.webm':
            return 'video/webm';
        default:
            return 'application/octet-stream';
    }
}
function resolveLocalPath(filePath) {
    if (filePath.startsWith('~')) {
        return path.join(os.homedir(), filePath.slice(1));
    }
    return path.resolve(filePath);
}
function isLocalFilePath(input) {
    if (!input || typeof input !== 'string')
        return false;
    if (input.startsWith('http://') || input.startsWith('https://'))
        return false;
    const resolved = resolveLocalPath(input);
    return fs.existsSync(resolved);
}
async function uploadMediaFile(inputPath, preferredFileName) {
    const resolvedPath = resolveLocalPath(inputPath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Local file not found at path: ${inputPath} (resolved: ${resolvedPath})`);
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
        throw new Error(`Path is not a regular file: ${resolvedPath}`);
    }
    const fileName = preferredFileName || path.basename(resolvedPath);
    const mimeType = getMimeType(resolvedPath);
    const size = stat.size;
    // 1. Try requesting a pre-signed PUT upload URL from SocialDispatch API
    // This enables direct upload to Cloudflare R2, bypassing all reverse proxy & server payload limits!
    try {
        const presignRes = await apiClient.post('/api/media/presigned-url', { fileName, mimeType, size }, { timeout: 15000 });
        const data = presignRes.data;
        if (data?.success && data?.storageProvider === 'R2' && data?.uploadUrl) {
            // Direct PUT to Cloudflare R2
            const readStream = fs.createReadStream(resolvedPath);
            await axios.put(data.uploadUrl, readStream, {
                headers: {
                    'Content-Type': mimeType,
                    'Content-Length': size,
                    ...(data.headers || {}),
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 900000, // 15 minutes for large files
            });
            return {
                url: data.publicUrl,
                id: data.id || data.fileName,
                fileName: data.fileName,
                mimeType,
                size,
                storageProvider: 'R2',
            };
        }
    }
    catch (err) {
        // If presigned URL endpoint is not supported or failed, log and fall through to direct multipart upload
        console.error(`[SocialDispatch MCP] Presigned URL failed, falling back to direct upload: ${err.message}`);
    }
    // 2. Direct multipart stream upload to /api/media/upload
    const form = new FormData();
    form.append('file', fs.createReadStream(resolvedPath), {
        filename: fileName,
        contentType: mimeType,
        knownLength: size,
    });
    const uploadRes = await apiClient.post('/api/media/upload', form, {
        headers: {
            ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 900000, // 15 minutes
    });
    if (!uploadRes.data?.success || !uploadRes.data?.media?.url) {
        throw new Error(uploadRes.data?.error || 'Direct media upload failed on SocialDispatch server.');
    }
    return {
        url: uploadRes.data.media.url,
        id: uploadRes.data.media.id,
        fileName: uploadRes.data.media.fileName,
        mimeType: uploadRes.data.media.mimeType,
        size: uploadRes.data.media.size,
        storageProvider: uploadRes.data.media.storageProvider || 'LOCAL',
    };
}
async function resolveAllMediaUrls(params) {
    const finalUrls = [];
    const uploadedResults = [];
    // 1. Process explicit mediaFiles (local paths to upload)
    if (Array.isArray(params.mediaFiles)) {
        for (const filePath of params.mediaFiles) {
            if (typeof filePath === 'string' && filePath.trim()) {
                const result = await uploadMediaFile(filePath.trim());
                finalUrls.push(result.url);
                uploadedResults.push(result);
            }
        }
    }
    // 2. Process mediaUrls: keep http(s) URLs as-is; if local path was provided, upload it automatically
    if (Array.isArray(params.mediaUrls)) {
        for (const item of params.mediaUrls) {
            if (typeof item === 'string' && item.trim()) {
                const trimmed = item.trim();
                if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
                    finalUrls.push(trimmed);
                }
                else if (isLocalFilePath(trimmed)) {
                    const result = await uploadMediaFile(trimmed);
                    finalUrls.push(result.url);
                    uploadedResults.push(result);
                }
                else {
                    finalUrls.push(trimmed);
                }
            }
        }
    }
    return { urls: finalUrls, uploaded: uploadedResults };
}
async function resolveThumbnailUrl(thumbCandidate) {
    if (!thumbCandidate || typeof thumbCandidate !== 'string')
        return {};
    const trimmed = thumbCandidate.trim();
    if (!trimmed)
        return {};
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return { url: trimmed };
    }
    if (isLocalFilePath(trimmed)) {
        try {
            const uploaded = await uploadMediaFile(trimmed);
            return { url: uploaded.url, uploaded };
        }
        catch (err) {
            console.error(`[SocialDispatch MCP] Failed to upload thumbnail "${trimmed}": ${err.message}`);
            throw err;
        }
    }
    return { url: trimmed };
}
function extractAutoThumbnail(resolvedMediaUrls, explicitThumb) {
    if (explicitThumb && explicitThumb.trim()) {
        return { thumb: explicitThumb.trim(), filteredMediaUrls: resolvedMediaUrls };
    }
    if (resolvedMediaUrls.length <= 1) {
        return { thumb: undefined, filteredMediaUrls: resolvedMediaUrls };
    }
    const hasVideo = resolvedMediaUrls.some((u) => u.match(/\.(mp4|mov|webm|mkv|avi)(\?.*)?$/i));
    const imageIndex = resolvedMediaUrls.findIndex((u) => u.match(/\.(jpg|jpeg|png|webp)(\?.*)?$/i));
    if (hasVideo && imageIndex !== -1) {
        const detectedThumb = resolvedMediaUrls[imageIndex];
        const filtered = resolvedMediaUrls.filter((_, idx) => idx !== imageIndex);
        return { thumb: detectedThumb, filteredMediaUrls: filtered };
    }
    return { thumb: undefined, filteredMediaUrls: resolvedMediaUrls };
}
const server = new Server({
    name: 'socialdispatch-mcp',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// Define MCP Tools
const TOOLS = [
    {
        name: 'list_social_connections',
        description: 'List all connected social media accounts/pages (Facebook Pages, Instagram, X/Twitter, TikTok, YouTube) in SocialDispatch. Returns connection IDs, names, platforms, and connection status.',
        inputSchema: {
            type: 'object',
            properties: {
                platform: {
                    type: 'string',
                    enum: ['facebook', 'instagram', 'x', 'youtube', 'tiktok'],
                    description: 'Filter connections by specific platform (optional)',
                },
            },
        },
    },
    {
        name: 'generate_social_content',
        description: 'Generate platform-tailored social media post drafts for Facebook, Instagram, and X (Twitter) from a topic, idea, or link using SocialDispatch AI copywriting engine.',
        inputSchema: {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    description: 'The core topic, announcement, or rough draft notes to turn into social posts',
                },
                tone: {
                    type: 'string',
                    enum: ['engaging', 'professional', 'casual', 'witty', 'urgent'],
                    description: 'Tone of voice for the copy (default: engaging)',
                },
                linkUrl: {
                    type: 'string',
                    description: 'Optional URL link to include in the generated copy',
                },
            },
            required: ['topic'],
        },
    },
    {
        name: 'upload_media',
        description: 'Upload a local image or video file directly to SocialDispatch and its enabled storage (Cloudflare R2 or local storage). Returns the public media URL, storage provider, and metadata to use for publishing.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute or relative path to the local media file on disk (e.g. "/path/to/video.mp4" or "./image.png")',
                },
                fileName: {
                    type: 'string',
                    description: 'Optional custom file name to assign to the uploaded asset',
                },
            },
            required: ['filePath'],
        },
    },
    {
        name: 'publish_social_post',
        description: 'Publish a social post immediately across one or more connected social accounts in SocialDispatch. Supports remote media URLs or local file paths directly.',
        inputSchema: {
            type: 'object',
            properties: {
                accountIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of connection IDs to publish to (obtained via list_social_connections)',
                },
                content: {
                    type: 'string',
                    description: 'Text caption/content of the post (or video description on YouTube)',
                },
                title: {
                    type: 'string',
                    description: 'Video title for platforms requiring dedicated titles (e.g. YouTube). Max 100 characters. If omitted, falls back to the first line of content.',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Keywords/tags for video discovery (supported on YouTube SEO).',
                },
                privacyStatus: {
                    type: 'string',
                    enum: ['public', 'unlisted', 'private'],
                    description: 'Video privacy visibility (supported on YouTube, defaults to "public").',
                },
                isShort: {
                    type: 'boolean',
                    description: 'Explicitly designate video as a YouTube Short (appends #Shorts to title and formats link as youtube.com/shorts/...). If omitted, auto-detected from aspect ratio and duration.',
                },
                linkUrl: {
                    type: 'string',
                    description: 'Optional URL for link preview card',
                },
                mediaFiles: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional array of local file paths on disk (e.g. ["/path/to/video.mp4"]) to upload directly to SocialDispatch storage and attach to post',
                },
                mediaUrls: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional array of publicly accessible image or video URLs to attach (or local file paths, which will be automatically uploaded)',
                },
                variantContents: {
                    type: 'object',
                    description: 'Optional dictionary of platform-specific or account-specific text overrides (e.g. {"facebook": "...", "x": "..."})',
                },
                thumbnailUrl: {
                    type: 'string',
                    description: 'Optional public image URL to use as custom video thumbnail (supported for YouTube, Facebook, and TikTok; JPEG/PNG recommended max 2MB for YouTube, up to 10MB for Facebook)',
                },
                thumbnailFile: {
                    type: 'string',
                    description: 'Optional local file path to a custom thumbnail image on disk (e.g. "/path/to/thumb.jpg") to automatically upload and set for YouTube, Facebook, or TikTok videos',
                },
                youtubeThumbnail: {
                    type: 'string',
                    description: 'Alias for thumbnailFile/thumbnailUrl: custom thumbnail image path or URL for video uploads',
                },
                facebookThumbnail: {
                    type: 'string',
                    description: 'Alias for thumbnailFile/thumbnailUrl: custom thumbnail image path or URL for Facebook video uploads',
                },
                tiktokThumbnail: {
                    type: 'string',
                    description: 'Alias for thumbnailFile/thumbnailUrl: custom thumbnail image path or URL for TikTok video uploads',
                },
                isAlteredContent: {
                    type: 'boolean',
                    description: 'Whether the content contains AI-generated or altered media. Defaults to true for compliance with YouTube (containsSyntheticMedia), Facebook & Instagram (is_ai_generated), and TikTok (is_aigc).',
                },
            },
            required: ['accountIds'],
        },
    },
    {
        name: 'schedule_social_post',
        description: 'Schedule a social post for a specific future date/time or into the next scheduled queue slot. Supports remote media URLs or local file paths directly.',
        inputSchema: {
            type: 'object',
            properties: {
                accountIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'List of connection IDs to post to',
                },
                content: {
                    type: 'string',
                    description: 'Text caption/content of the post (or video description on YouTube)',
                },
                title: {
                    type: 'string',
                    description: 'Video title for platforms requiring dedicated titles (e.g. YouTube). Max 100 characters. If omitted, falls back to the first line of content.',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Keywords/tags for video discovery (supported on YouTube SEO).',
                },
                privacyStatus: {
                    type: 'string',
                    enum: ['public', 'unlisted', 'private'],
                    description: 'Video privacy visibility (supported on YouTube, defaults to "public").',
                },
                isShort: {
                    type: 'boolean',
                    description: 'Explicitly designate video as a YouTube Short (appends #Shorts to title and formats link as youtube.com/shorts/...). If omitted, auto-detected from aspect ratio and duration.',
                },
                scheduledAt: {
                    type: 'string',
                    description: 'ISO-8601 datetime string when the post should be published (e.g. "2026-10-15T15:30:00Z")',
                },
                useQueueSlot: {
                    type: 'boolean',
                    description: 'If true, automatically assigns the post to the next available configured posting slot',
                },
                linkUrl: {
                    type: 'string',
                    description: 'Optional URL link',
                },
                mediaFiles: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional array of local file paths on disk (e.g. ["/path/to/video.mp4"]) to upload directly to SocialDispatch storage and attach to post',
                },
                mediaUrls: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional array of media URLs (or local file paths, which will be automatically uploaded)',
                },
                variantContents: {
                    type: 'object',
                    description: 'Optional platform-tailored text overrides',
                },
                thumbnailUrl: {
                    type: 'string',
                    description: 'Optional public image URL to use as custom video thumbnail (supported for YouTube, Facebook, and TikTok; JPEG/PNG recommended max 2MB for YouTube, up to 10MB for Facebook)',
                },
                thumbnailFile: {
                    type: 'string',
                    description: 'Optional local file path to a custom thumbnail image on disk (e.g. "/path/to/thumb.jpg") to automatically upload and set for YouTube, Facebook, or TikTok videos',
                },
                youtubeThumbnail: {
                    type: 'string',
                    description: 'Alias for thumbnailFile/thumbnailUrl: custom thumbnail image path or URL for video uploads',
                },
                facebookThumbnail: {
                    type: 'string',
                    description: 'Alias for thumbnailFile/thumbnailUrl: custom thumbnail image path or URL for Facebook video uploads',
                },
                tiktokThumbnail: {
                    type: 'string',
                    description: 'Alias for thumbnailFile/thumbnailUrl: custom thumbnail image path or URL for TikTok video uploads',
                },
                isAlteredContent: {
                    type: 'boolean',
                    description: 'Whether the content contains AI-generated or altered media. Defaults to true for compliance with YouTube (containsSyntheticMedia), Facebook & Instagram (is_ai_generated), and TikTok (is_aigc).',
                },
            },
            required: ['accountIds'],
        },
    },
    {
        name: 'generate_and_publish_post',
        description: 'End-to-end AI agent action: Generates platform-tailored copies (Facebook, Instagram, X) from a topic and immediately publishes (or schedules) across target connections. Supports remote media URLs or local file paths directly.',
        inputSchema: {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    description: 'Topic, product announcement, or instructions for the AI copywriter',
                },
                accountIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Target connection IDs to publish to',
                },
                tone: {
                    type: 'string',
                    enum: ['engaging', 'professional', 'casual', 'witty', 'urgent'],
                    description: 'Tone of voice',
                },
                linkUrl: {
                    type: 'string',
                    description: 'Optional link to attach',
                },
                mediaFiles: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional array of local file paths on disk (e.g. ["/path/to/video.mp4"]) to upload directly to SocialDispatch storage and attach to post',
                },
                mediaUrls: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Optional array of image or video URLs to attach (or local file paths, which will be automatically uploaded)',
                },
                publishImmediately: {
                    type: 'boolean',
                    description: 'Whether to publish immediately (default: true)',
                },
                scheduledAt: {
                    type: 'string',
                    description: 'Optional ISO-8601 datetime if scheduling for future',
                },
            },
            required: ['topic', 'accountIds'],
        },
    },
    {
        name: 'get_post_status',
        description: 'Check publication status, external live URLs, and execution logs for a specific post in SocialDispatch.',
        inputSchema: {
            type: 'object',
            properties: {
                postId: {
                    type: 'string',
                    description: 'The unique ID of the post to inspect',
                },
            },
            required: ['postId'],
        },
    },
    {
        name: 'list_recent_posts',
        description: 'List recent posts in SocialDispatch to see publishing history, scheduled queue items, and statuses.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'number',
                    description: 'Number of posts to return (default: 10, max: 50)',
                },
                status: {
                    type: 'string',
                    enum: ['DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'PARTIALLY_PUBLISHED'],
                    description: 'Filter posts by status',
                },
            },
        },
    },
    {
        name: 'update_social_post',
        description: 'Update or edit a post content or schedule in SocialDispatch. If the post is already published, you can optionally set updateOnPlatform=true to sync the update to supported live platforms (Facebook Page, YouTube).',
        inputSchema: {
            type: 'object',
            properties: {
                postId: {
                    type: 'string',
                    description: 'The unique ID of the post to update',
                },
                content: {
                    type: 'string',
                    description: 'Updated text content/caption of the post (or video description on YouTube)',
                },
                title: {
                    type: 'string',
                    description: 'Updated video title (for YouTube uploads)',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Updated video SEO tags (for YouTube uploads)',
                },
                privacyStatus: {
                    type: 'string',
                    enum: ['public', 'unlisted', 'private'],
                    description: 'Updated video privacy visibility status',
                },
                isShort: {
                    type: 'boolean',
                    description: 'Designate video as YouTube Short',
                },
                linkUrl: {
                    type: 'string',
                    description: 'Updated link URL preview',
                },
                scheduledAt: {
                    type: 'string',
                    description: 'Optional updated ISO-8601 datetime if rescheduling',
                },
                updateOnPlatform: {
                    type: 'boolean',
                    description: 'If true and post is published, also attempts to update live content on supported platforms (Facebook, YouTube). Note: 𝕏, Instagram, and TikTok APIs do not allow editing published posts.',
                },
                variantContents: {
                    type: 'object',
                    description: 'Optional platform or account-specific text overrides',
                },
                thumbnailUrl: {
                    type: 'string',
                    description: 'Optional public image URL to update the custom video thumbnail for published YouTube or Facebook videos (when updateOnPlatform is true)',
                },
                thumbnailFile: {
                    type: 'string',
                    description: 'Optional local file path to upload and update custom video thumbnail for published YouTube or Facebook videos (when updateOnPlatform is true)',
                },
            },
            required: ['postId'],
        },
    },
    {
        name: 'delete_social_post',
        description: 'Delete a post from SocialDispatch. Supports deleting locally only, or deleting both locally and from connected live platforms (Facebook, X/Twitter, YouTube).',
        inputSchema: {
            type: 'object',
            properties: {
                postId: {
                    type: 'string',
                    description: 'The unique ID of the post to delete',
                },
                deleteFromPlatform: {
                    type: 'boolean',
                    description: 'If true, deletes the post from connected social media platforms (X/Twitter, Facebook, YouTube) in addition to deleting locally in SocialDispatch. Defaults to false (local delete only). Note that Instagram and TikTok APIs do not support automated post deletion.',
                },
            },
            required: ['postId'],
        },
    },
    {
        name: 'add_content_ideas',
        description: 'Batch adds new content ideas/plans into the SocialDispatch pipeline queue in IDEA stage. Allows brainstorming and researching batches of content ideas (up to 50 at once).',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceId: {
                    type: 'string',
                    description: 'Target workspace ID (optional if using default API key workspace)',
                },
                accountId: {
                    type: 'string',
                    description: 'Optional default target social account/page ID for these ideas',
                },
                ideas: {
                    type: 'array',
                    description: 'List of content ideas to insert into the queue',
                    items: {
                        type: 'object',
                        properties: {
                            title: {
                                type: 'string',
                                description: 'Headline or working title of the content idea',
                            },
                            topicNotes: {
                                type: 'string',
                                description: 'Research notes, bullets, source URLs, reference thoughts',
                            },
                            script: {
                                type: 'string',
                                description: 'Optional draft script, hook, or caption text',
                            },
                            metadata: {
                                type: 'object',
                                description: 'Custom metadata (tags, language: "en"/"bn", target aspect ratio: "9:16"/"16:9", etc.)',
                            },
                        },
                        required: ['title'],
                    },
                },
            },
            required: ['ideas'],
        },
    },
    {
        name: 'list_content_pipeline',
        description: 'Returns current queued items in the SocialDispatch content pipeline, showing counts and progress (e.g. 3 generated, 7 pending ideas).',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceId: {
                    type: 'string',
                    description: 'Target workspace ID (optional)',
                },
                stage: {
                    type: 'string',
                    enum: ['IDEA', 'SCRIPTED', 'GENERATING', 'GENERATED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'],
                    description: 'Optional filter by content stage (IDEA, SCRIPTED, GENERATING, GENERATED, etc.)',
                },
                accountId: {
                    type: 'string',
                    description: 'Optional filter by social account ID',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of items to return (default: 50)',
                },
            },
        },
    },
    {
        name: 'update_content_progress',
        description: 'Updates progress of a content item after script generation or media rendering (transitions stage to SCRIPTED, GENERATING, or GENERATED, and attaches script or media).',
        inputSchema: {
            type: 'object',
            properties: {
                itemId: {
                    type: 'string',
                    description: 'The unique ID of the content item in the pipeline',
                },
                stage: {
                    type: 'string',
                    enum: ['IDEA', 'SCRIPTED', 'GENERATING', 'GENERATED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'],
                    description: 'The updated stage (typically SCRIPTED, GENERATING, or GENERATED)',
                },
                script: {
                    type: 'string',
                    description: 'Updated voiceover script, body text, or refined caption',
                },
                localMediaPath: {
                    type: 'string',
                    description: 'Local file path on disk where rendered video or image is stored',
                },
                mediaUrl: {
                    type: 'string',
                    description: 'Remote public media URL (if already uploaded or hosted remotely)',
                },
                workspaceId: {
                    type: 'string',
                    description: 'Target workspace ID (optional)',
                },
            },
            required: ['itemId', 'stage'],
        },
    },
    {
        name: 'get_next_pipeline_item',
        description: 'Retrieves the next oldest or prioritized ungenerated content item from the pipeline queue to resume work where left off across sessions.',
        inputSchema: {
            type: 'object',
            properties: {
                workspaceId: {
                    type: 'string',
                    description: 'Target workspace ID (optional)',
                },
                accountId: {
                    type: 'string',
                    description: 'Filter by target social account ID (optional)',
                },
                stage: {
                    type: 'string',
                    enum: ['IDEA', 'SCRIPTED', 'GENERATING', 'GENERATED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED'],
                    description: 'The pipeline stage to pull next item from (default: IDEA)',
                },
            },
        },
    },
];
// Handle ListTools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: TOOLS,
    };
});
// Handle CallTool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case 'list_social_connections': {
                const res = await apiClient.get('/api/v1/connections');
                let connections = res.data?.connections || [];
                if (args?.platform) {
                    connections = connections.filter((c) => c.platform.toLowerCase() === String(args.platform).toLowerCase());
                }
                const summary = connections.map((c) => ({
                    connectionId: c.id,
                    platform: c.platform,
                    name: c.name,
                    status: c.status,
                    platformAccountId: c.platformAccountId,
                    connectedAt: c.createdAt,
                }));
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                count: summary.length,
                                connections: summary,
                                message: summary.length === 0
                                    ? 'No connected social accounts found in SocialDispatch. Connect channels in the SocialDispatch web dashboard.'
                                    : `Found ${summary.length} connected account(s). Use 'connectionId' in publish_social_post or generate_and_publish_post.`,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'generate_social_content': {
                const res = await apiClient.post('/api/v1/ai/generate', {
                    topic: args?.topic,
                    tone: args?.tone || 'engaging',
                    linkUrl: args?.linkUrl,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(res.data, null, 2),
                        },
                    ],
                };
            }
            case 'upload_media': {
                if (!args?.filePath || typeof args.filePath !== 'string') {
                    throw new Error('filePath is required (e.g. "/path/to/video.mp4")');
                }
                const uploaded = await uploadMediaFile(args.filePath, args?.fileName);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                message: `Media successfully uploaded to SocialDispatch ${uploaded.storageProvider} storage!`,
                                media: uploaded,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'publish_social_post': {
                const { urls: rawMediaUrls, uploaded } = await resolveAllMediaUrls({
                    mediaUrls: args?.mediaUrls,
                    mediaFiles: args?.mediaFiles,
                });
                const explicitThumb = (args?.thumbnailFile || args?.thumbnailUrl || args?.youtubeThumbnail || args?.facebookThumbnail || args?.tiktokThumbnail);
                const { thumb: thumbCandidate, filteredMediaUrls: resolvedMediaUrls } = extractAutoThumbnail(rawMediaUrls, explicitThumb);
                const resolvedThumb = await resolveThumbnailUrl(thumbCandidate);
                if (resolvedThumb.uploaded) {
                    uploaded.push(resolvedThumb.uploaded);
                }
                const platformOptions = {
                    isAlteredContent: args?.isAlteredContent ?? true,
                    ...(args?.platformOptions || {}),
                    ...(args?.title ? { title: String(args.title) } : {}),
                    ...(Array.isArray(args?.tags) ? { tags: args.tags } : {}),
                    ...(args?.privacyStatus ? { privacyStatus: String(args.privacyStatus) } : {}),
                    ...(args?.isShort !== undefined ? { isShort: Boolean(args.isShort) } : {}),
                    ...(resolvedThumb.url ? { thumbnailUrl: resolvedThumb.url } : {}),
                };
                const res = await apiClient.post('/api/v1/posts', {
                    accountIds: args?.accountIds,
                    content: args?.content,
                    linkUrl: args?.linkUrl,
                    mediaUrls: resolvedMediaUrls.length > 0 ? resolvedMediaUrls : undefined,
                    variantContents: args?.variantContents,
                    platformOptions,
                    publishImmediately: true,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                message: 'Post enqueued for immediate publishing!',
                                ...(resolvedThumb.url ? { customThumbnail: resolvedThumb.url } : {}),
                                ...(uploaded.length > 0
                                    ? {
                                        uploadedMedia: uploaded.map((u) => ({
                                            url: u.url,
                                            fileName: u.fileName,
                                            size: u.size,
                                            storageProvider: u.storageProvider,
                                        })),
                                    }
                                    : {}),
                                ...res.data,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'schedule_social_post': {
                const { urls: rawMediaUrls, uploaded } = await resolveAllMediaUrls({
                    mediaUrls: args?.mediaUrls,
                    mediaFiles: args?.mediaFiles,
                });
                const explicitThumb = (args?.thumbnailFile || args?.thumbnailUrl || args?.youtubeThumbnail || args?.facebookThumbnail || args?.tiktokThumbnail);
                const { thumb: thumbCandidate, filteredMediaUrls: resolvedMediaUrls } = extractAutoThumbnail(rawMediaUrls, explicitThumb);
                const resolvedThumb = await resolveThumbnailUrl(thumbCandidate);
                if (resolvedThumb.uploaded) {
                    uploaded.push(resolvedThumb.uploaded);
                }
                const platformOptions = {
                    isAlteredContent: args?.isAlteredContent ?? true,
                    ...(args?.platformOptions || {}),
                    ...(args?.title ? { title: String(args.title) } : {}),
                    ...(Array.isArray(args?.tags) ? { tags: args.tags } : {}),
                    ...(args?.privacyStatus ? { privacyStatus: String(args.privacyStatus) } : {}),
                    ...(args?.isShort !== undefined ? { isShort: Boolean(args.isShort) } : {}),
                    ...(resolvedThumb.url ? { thumbnailUrl: resolvedThumb.url } : {}),
                };
                const res = await apiClient.post('/api/v1/posts', {
                    accountIds: args?.accountIds,
                    content: args?.content,
                    scheduledAt: args?.scheduledAt,
                    useQueueSlot: Boolean(args?.useQueueSlot),
                    linkUrl: args?.linkUrl,
                    mediaUrls: resolvedMediaUrls.length > 0 ? resolvedMediaUrls : undefined,
                    variantContents: args?.variantContents,
                    platformOptions,
                    publishImmediately: false,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                message: 'Post scheduled successfully!',
                                ...(resolvedThumb.url ? { customThumbnail: resolvedThumb.url } : {}),
                                ...(uploaded.length > 0
                                    ? {
                                        uploadedMedia: uploaded.map((u) => ({
                                            url: u.url,
                                            fileName: u.fileName,
                                            size: u.size,
                                            storageProvider: u.storageProvider,
                                        })),
                                    }
                                    : {}),
                                ...res.data,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'generate_and_publish_post': {
                const { urls: resolvedMediaUrls, uploaded } = await resolveAllMediaUrls({
                    mediaUrls: args?.mediaUrls,
                    mediaFiles: args?.mediaFiles,
                });
                const res = await apiClient.post('/api/v1/ai/generate-and-post', {
                    topic: args?.topic,
                    accountIds: args?.accountIds,
                    tone: args?.tone || 'engaging',
                    linkUrl: args?.linkUrl,
                    mediaUrls: resolvedMediaUrls,
                    publishImmediately: args?.publishImmediately ?? true,
                    scheduledAt: args?.scheduledAt,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                ...(uploaded.length > 0
                                    ? {
                                        uploadedMedia: uploaded.map((u) => ({
                                            url: u.url,
                                            fileName: u.fileName,
                                            size: u.size,
                                            storageProvider: u.storageProvider,
                                        })),
                                    }
                                    : {}),
                                ...res.data,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'get_post_status': {
                const res = await apiClient.get(`/api/v1/posts/${args?.postId}`);
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(res.data, null, 2),
                        },
                    ],
                };
            }
            case 'list_recent_posts': {
                const res = await apiClient.get('/api/v1/posts', {
                    params: {
                        limit: args?.limit || 10,
                        status: args?.status,
                    },
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(res.data, null, 2),
                        },
                    ],
                };
            }
            case 'update_social_post': {
                const thumbCandidate = (args?.thumbnailFile || args?.thumbnailUrl || args?.youtubeThumbnail || args?.facebookThumbnail || args?.tiktokThumbnail);
                const resolvedThumb = await resolveThumbnailUrl(thumbCandidate);
                const platformOptions = {
                    isAlteredContent: args?.isAlteredContent ?? true,
                    ...(args?.platformOptions || {}),
                    ...(args?.title ? { title: String(args.title) } : {}),
                    ...(Array.isArray(args?.tags) ? { tags: args.tags } : {}),
                    ...(args?.privacyStatus ? { privacyStatus: String(args.privacyStatus) } : {}),
                    ...(args?.isShort !== undefined ? { isShort: Boolean(args.isShort) } : {}),
                    ...(resolvedThumb.url ? { thumbnailUrl: resolvedThumb.url } : {}),
                };
                const res = await apiClient.patch(`/api/v1/posts/${args?.postId}`, {
                    content: args?.content,
                    linkUrl: args?.linkUrl,
                    scheduledAt: args?.scheduledAt,
                    updateOnPlatform: Boolean(args?.updateOnPlatform),
                    variantContents: args?.variantContents,
                    platformOptions,
                    ...(resolvedThumb.url ? { thumbnailUrl: resolvedThumb.url } : {}),
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                ...(resolvedThumb.url ? { customThumbnail: resolvedThumb.url } : {}),
                                ...res.data,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'delete_social_post': {
                const res = await apiClient.delete(`/api/v1/posts/${args?.postId}`, {
                    data: {
                        deleteFromPlatform: Boolean(args?.deleteFromPlatform),
                    },
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(res.data, null, 2),
                        },
                    ],
                };
            }
            case 'add_content_ideas': {
                const workspaceId = args?.workspaceId;
                const endpoint = workspaceId
                    ? `/api/workspaces/${workspaceId}/pipeline/batch`
                    : '/api/pipeline/batch';
                const res = await apiClient.post(endpoint, {
                    workspaceId,
                    socialAccountId: args?.accountId,
                    ideas: args?.ideas,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                message: `Successfully added ${res.data?.count || args?.ideas?.length || 0} idea(s) to pipeline queue.`,
                                ...res.data,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'list_content_pipeline': {
                const workspaceId = args?.workspaceId;
                const endpoint = workspaceId
                    ? `/api/workspaces/${workspaceId}/pipeline`
                    : '/api/pipeline';
                const res = await apiClient.get(endpoint, {
                    params: {
                        stage: args?.stage,
                        socialAccountId: args?.accountId,
                        limit: args?.limit || 50,
                    },
                });
                const data = res.data;
                const total = data?.total ?? data?.items?.length ?? 0;
                const summary = data?.summary || {};
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                totalQueued: total,
                                stageSummary: summary?.byStage,
                                items: data?.items,
                                message: `${total} items queued — ${summary?.byStage?.GENERATED || 0} Generated, ${summary?.byStage?.IDEA || 0} In Idea Backlog`,
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'update_content_progress': {
                if (!args?.itemId) {
                    throw new Error('itemId is required to update pipeline progress');
                }
                if (!args?.stage) {
                    throw new Error('stage is required (SCRIPTED, GENERATING, GENERATED, etc.)');
                }
                let mediaUrl = args?.mediaUrl;
                const localMediaPath = args?.localMediaPath;
                let uploadedAsset;
                // If local file path provided and mediaUrl omitted, try auto-uploading to storage
                if (localMediaPath && !mediaUrl && isLocalFilePath(localMediaPath)) {
                    try {
                        uploadedAsset = await uploadMediaFile(localMediaPath);
                        mediaUrl = uploadedAsset.url;
                    }
                    catch (uploadErr) {
                        console.error(`[SocialDispatch MCP] Optional auto-upload of local media failed: ${uploadErr.message}`);
                    }
                }
                const workspaceId = args?.workspaceId;
                const endpoint = workspaceId
                    ? `/api/workspaces/${workspaceId}/pipeline/${args.itemId}`
                    : `/api/pipeline/${args.itemId}`;
                const res = await apiClient.patch(endpoint, {
                    stage: args.stage,
                    script: args?.script,
                    localMediaPath,
                    mediaUrl,
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                message: `Pipeline item "${res.data?.title || args.itemId}" transitioned to ${args.stage}`,
                                item: res.data,
                                ...(uploadedAsset ? { uploadedMedia: uploadedAsset } : {}),
                            }, null, 2),
                        },
                    ],
                };
            }
            case 'get_next_pipeline_item': {
                const workspaceId = args?.workspaceId;
                const endpoint = workspaceId
                    ? `/api/workspaces/${workspaceId}/pipeline/next`
                    : '/api/pipeline/next';
                const res = await apiClient.get(endpoint, {
                    params: {
                        stage: args?.stage || 'IDEA',
                        accountId: args?.accountId,
                    },
                });
                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify({
                                success: true,
                                found: Boolean(res.data?.id),
                                item: res.data,
                                message: res.data?.id
                                    ? `Retrieved next item: "${res.data.title}" (Stage: ${res.data.stage})`
                                    : 'No pending items found for the requested stage and criteria.',
                            }, null, 2),
                        },
                    ],
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (err) {
        const errorDetails = err.response?.data || err.message;
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        error: `Tool execution failed for ${name}`,
                        apiUrl: API_BASE_URL,
                        details: errorDetails,
                    }, null, 2),
                },
            ],
            isError: true,
        };
    }
});
async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[SocialDispatch MCP] Server connected via stdio transport.');
}
run().catch((error) => {
    console.error('[SocialDispatch MCP] Fatal error running server:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map