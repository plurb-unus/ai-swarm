/**
 * AI Swarm v2 - Notification Activity
 *
 * Sends email notifications via configurable providers.
 */

import {
    NotificationInput,
    logger,
    logActivityStart,
    logActivityComplete,
    systemConfigService,
} from '@ai-swarm/shared';

/**
 * Send a notification email.
 */
export async function sendNotification(input: NotificationInput): Promise<void> {
    const startTime = Date.now();
    logActivityStart('notification', 'sendNotification', { subject: input.subject });

    // Fetch email config from database, fall back to env vars
    let apiKey = process.env.EMAIL_API_KEY;
    let provider = process.env.EMAIL_PROVIDER || 'resend';
    let from = process.env.EMAIL_FROM || 'noreply@example.com';
    let to = process.env.EMAIL_TO || 'admin@example.com';

    try {
        const emailConfig = await systemConfigService.getEmailConfig();
        apiKey = emailConfig.apiKey || apiKey;
        provider = emailConfig.provider || provider;
        from = emailConfig.from || from;
        to = emailConfig.to || to;
    } catch (err) {
        logger.debug({ err }, 'Failed to load email config from database, using env vars');
    }

    // If no API key, just log the notification
    if (!apiKey) {
        logger.info(
            {
                subject: input.subject,
                body: input.body.slice(0, 200),
                priority: input.priority,
            },
            'Notification (no email configured)'
        );

        const durationMs = Date.now() - startTime;
        logActivityComplete('notification', 'sendNotification', durationMs, true);
        return;
    }

    try {
        let response: Response;

        switch (provider) {
            case 'resend':
                response = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        from,
                        to,
                        subject: input.subject,
                        html: `<pre style="font-family: monospace; white-space: pre-wrap;">${escapeHtml(input.body)}</pre>`,
                    }),
                });
                break;

            case 'sendgrid':
                response = await fetch('https://api.sendgrid.com/v3/mail/send', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        personalizations: [{ to: [{ email: to }] }],
                        from: { email: from },
                        subject: input.subject,
                        content: [{ type: 'text/html', value: `<pre>${escapeHtml(input.body)}</pre>` }],
                    }),
                });
                break;

            default:
                logger.warn({ provider }, 'Unknown email provider, skipping');
                return;
        }

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Email API error: ${response.status} - ${errorBody}`);
        }

        logger.info({ subject: input.subject, provider }, 'Notification sent');

        const durationMs = Date.now() - startTime;
        logActivityComplete('notification', 'sendNotification', durationMs, true);
    } catch (error) {
        const durationMs = Date.now() - startTime;
        logActivityComplete('notification', 'sendNotification', durationMs, false);

        // Don't throw - notifications shouldn't break the workflow
        logger.error(
            { error: error instanceof Error ? error.message : String(error) },
            'Failed to send notification'
        );
    }
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
