/**
 * AI Swarm v2 - Chat Storage
 *
 * Redis-based conversation storage with 90-day TTL.
 */

// FIX: Replacing missing logger with console for Portal context
// or importing if available. For Portal, console is safer if shared logger isn't configured for browser/nextjs server edge.
import Redis from 'ioredis';

const logger = console; // Simple fallback for Portal

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
import { systemConfigService } from '@ai-swarm/shared';

// =============================================================================
// TYPES
// =============================================================================

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

export interface Conversation {
    tag: string;
    title: string;
    summary: string;
    messages: ChatMessage[];
    createdAt: string;
    updatedAt: string;
    userEmail: string;
    planReady: boolean;
}

export interface ConversationSummary {
    tag: string;
    title: string;
    summary: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Generate a tag from the first message.
 * Format: kebab-case-title-jan-30
 */
export function generateTag(firstMessage: string): string {
    // Take first 30 chars, lowercase, replace non-alphanumeric with dashes
    const titlePart = firstMessage
        .substring(0, 40)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 25);

    // Add date
    const now = new Date();
    const month = now.toLocaleString('en', { month: 'short' }).toLowerCase();
    const day = now.getDate();

    return `${titlePart}-${month}-${day}`;
}

/**
 * Generate summary from conversation.
 */
export function generateSummary(messages: ChatMessage[]): string {
    if (messages.length === 0) return '';

    const firstUserMessage = messages.find(m => m.role === 'user');
    if (!firstUserMessage) return '';

    return firstUserMessage.content.substring(0, 100) + (firstUserMessage.content.length > 100 ? '...' : '');
}

// =============================================================================
// STORAGE OPERATIONS
// =============================================================================

function getRedis(): Redis {
    return new Redis(REDIS_URL);
}

function conversationKey(userEmail: string, tag: string): string {
    return `chat:${userEmail}:${tag}`;
}

function userConversationsKey(userEmail: string): string {
    return `chat:${userEmail}:list`;
}

/**
 * Create a new conversation.
 */
export async function createConversation(
    userEmail: string,
    firstMessage: string
): Promise<Conversation> {
    const redis = getRedis();

    try {
        const tag = generateTag(firstMessage);
        const now = new Date().toISOString();

        const conversation: Conversation = {
            tag,
            title: firstMessage.substring(0, 50),
            summary: '',
            messages: [],
            createdAt: now,
            updatedAt: now,
            userEmail,
            planReady: false,
        };

        const maxAgeDays = await systemConfigService.getChatMaxAgeDays();
        const ttlSeconds = maxAgeDays * 24 * 60 * 60;

        // Store conversation
        await redis.setex(
            conversationKey(userEmail, tag),
            ttlSeconds,
            JSON.stringify(conversation)
        );

        // Add to user's conversation list
        await redis.zadd(userConversationsKey(userEmail), Date.now(), tag);

        return conversation;
    } finally {
        await redis.quit();
    }
}

/**
 * Get a conversation by tag.
 */
export async function getConversation(
    userEmail: string,
    tag: string
): Promise<Conversation | null> {
    const redis = getRedis();

    try {
        const data = await redis.get(conversationKey(userEmail, tag));
        if (!data) return null;

        return JSON.parse(data) as Conversation;
    } finally {
        await redis.quit();
    }
}

/**
 * Add a message to a conversation.
 */
export async function addMessage(
    userEmail: string,
    tag: string,
    role: 'user' | 'assistant',
    content: string
): Promise<Conversation | null> {
    const redis = getRedis();

    try {
        const conversation = await getConversation(userEmail, tag);
        if (!conversation) return null;

        const message: ChatMessage = {
            role,
            content,
            timestamp: new Date().toISOString(),
        };

        conversation.messages.push(message);
        conversation.updatedAt = new Date().toISOString();
        conversation.summary = generateSummary(conversation.messages);

        // Check if plan is ready (assistant returned JSON with required fields)
        if (role === 'assistant') {
            try {
                // Extract JSON from markdown code fences if present
                let jsonContent = content.trim();
                const fenceMatch = jsonContent.match(/```(?:\w+)?\s*([\s\S]*?)```/);
                if (fenceMatch) {
                    jsonContent = fenceMatch[1].trim();
                }

                // Find and parse JSON object with proposedChanges using balanced brace counting
                const startIdx = jsonContent.indexOf('{"proposedChanges"');
                const startIdx2 = jsonContent.indexOf('{ "proposedChanges"');
                const actualStart = startIdx >= 0 ? startIdx : startIdx2;

                if (actualStart >= 0) {
                    const jsonPart = jsonContent.substring(actualStart);
                    let depth = 0;
                    let endIdx = 0;
                    for (let i = 0; i < jsonPart.length; i++) {
                        if (jsonPart[i] === '{') depth++;
                        if (jsonPart[i] === '}') depth--;
                        if (depth === 0) {
                            endIdx = i + 1;
                            break;
                        }
                    }

                    if (endIdx > 0) {
                        const fullJson = jsonPart.substring(0, endIdx);
                        const parsed = JSON.parse(fullJson);
                        if (parsed.proposedChanges && parsed.verificationPlan) {
                            conversation.planReady = true;
                        }
                    }
                }
            } catch {
                // Not valid JSON or missing required fields, plan not ready
            }
        }

        const maxAgeDays = await systemConfigService.getChatMaxAgeDays();
        const ttlSeconds = maxAgeDays * 24 * 60 * 60;

        // Update storage
        await redis.setex(
            conversationKey(userEmail, tag),
            ttlSeconds,
            JSON.stringify(conversation)
        );

        // Update list timestamp
        await redis.zadd(userConversationsKey(userEmail), Date.now(), tag);

        return conversation;
    } finally {
        await redis.quit();
    }
}

/**
 * List user's conversations (most recent first).
 */
export async function listConversations(
    userEmail: string,
    limit: number = 20
): Promise<ConversationSummary[]> {
    const redis = getRedis();

    try {
        // Get tags, most recent first
        const tags = await redis.zrevrange(userConversationsKey(userEmail), 0, limit - 1);
        if (tags.length === 0) return [];

        // FIX: Optimized to use mget for O(1) retrieval instead of a loop of individual get calls
        const keys = tags.map(tag => conversationKey(userEmail, tag));
        const results = await redis.mget(...keys);

        const summaries: ConversationSummary[] = [];

        results.forEach((data, index) => {
            if (data) {
                try {
                    const conv = JSON.parse(data) as Conversation;
                    summaries.push({
                        tag: conv.tag,
                        title: conv.title,
                        summary: conv.summary,
                        createdAt: conv.createdAt,
                        updatedAt: conv.updatedAt,
                        messageCount: conv.messages.length,
                    });
                } catch (e) {
                    logger.warn({ tag: tags[index] }, 'Failed to parse conversation data');
                }
            }
        });

        return summaries;
    } finally {
        await redis.quit();
    }
}

/**
 * Delete a conversation.
 */
export async function deleteConversation(
    userEmail: string,
    tag: string
): Promise<boolean> {
    const redis = getRedis();

    try {
        const deleted = await redis.del(conversationKey(userEmail, tag));
        await redis.zrem(userConversationsKey(userEmail), tag);
        return deleted > 0;
    } finally {
        await redis.quit();
    }
}
