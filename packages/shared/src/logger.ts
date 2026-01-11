/**
 * AI Swarm v2 - Structured Logger
 *
 * Pino-based logger with JSON output for observability.
 */

import { pino } from 'pino';

const logLevel = process.env.LOG_LEVEL || 'info';

export const logger = pino({
    level: logLevel,
    transport:
        process.env.NODE_ENV === 'development'
            ? {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                },
            }
            : undefined,
    base: {
        service: 'ai-swarm',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger with additional context.
 */
export function createLogger(context: Record<string, unknown>) {
    return logger.child(context);
}

/**
 * Log an agent activity start.
 */
export function logActivityStart(
    role: string,
    activityName: string,
    input?: unknown
) {
    logger.info(
        {
            event: 'activity_start',
            role,
            activity: activityName,
            input: input ? JSON.stringify(input).slice(0, 500) : undefined,
        },
        `Starting activity: ${activityName}`
    );
}

/**
 * Log an agent activity completion.
 */
export function logActivityComplete(
    role: string,
    activityName: string,
    durationMs: number,
    success: boolean
) {
    logger.info(
        {
            event: 'activity_complete',
            role,
            activity: activityName,
            durationMs,
            success,
        },
        `Completed activity: ${activityName} (${durationMs}ms)`
    );
}
