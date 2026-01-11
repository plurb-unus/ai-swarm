/**
 * AI Swarm v3.0.0 - System Config API
 * 
 * GET/PUT endpoints for system configuration (claude_auth_mode, llm_roles, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { systemConfigService } from '@ai-swarm/shared';

export const runtime = 'nodejs';

// Keys that can be set via this API
const ALLOWED_KEYS = [
    'claude_auth_mode',
    'z_ai_api_key',
    'scm_token_azure_devops',
    'scm_token_github',
    'scm_token_gitlab',
    'default_project_dir',
    'workspace_root',
    'log_level',
    'email_provider',
    'email_api_key',
    'email_from',
    'email_to',
    'worker_count',
    'test_user_email',
    'test_user_password',
    'chat_max_age_days',
    'deployer_blacklist',  // v3.0.0: LLM Deployer container blacklist
    'onboarding_complete',
];

// Keys that are secrets (mask in GET response)
const SECRET_KEYS = [
    'z_ai_api_key',
    'scm_token_azure_devops',
    'scm_token_github',
    'scm_token_gitlab',
    'email_api_key',
    'test_user_password',
];

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const config: Record<string, any> = {
            claude_auth_mode: await systemConfigService.getClaudeAuthMode(),
            llm_roles: await systemConfigService.getAllLLMRoles(),
            deployer_blacklist: (await systemConfigService.getDeployerBlacklist()).join(', '),
        };

        // Fetch all other keys using resolved values (DB first, then ENV)
        for (const key of ALLOWED_KEYS) {
            if (key === 'claude_auth_mode') continue;
            const val = await systemConfigService.getResolvedConfig(key);
            if (SECRET_KEYS.includes(key) && val) {
                config[key] = '••••••••' + val.slice(-4);
            } else {
                config[key] = val || '';
            }
        }

        return NextResponse.json(config);
    } catch (error) {
        console.error('Failed to get system config:', error);
        return NextResponse.json(
            { error: 'Failed to get system config' },
            { status: 500 }
        );
    }
}

export async function PUT(request: NextRequest) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { key, value, role, provider } = body;

        // Handle claude_auth_mode
        if (key === 'claude_auth_mode') {
            if (!['oauth', 'zai'].includes(value)) {
                return NextResponse.json(
                    { error: `Invalid value for claude_auth_mode: ${value}` },
                    { status: 400 }
                );
            }
            await systemConfigService.setClaudeAuthMode(value);
            return NextResponse.json({ success: true, key, value });
        }

        // Handle LLM role updates
        if (key === 'llm_role' && role && provider) {
            const validRoles = ['planner', 'coder', 'reviewer', 'portal_planner', 'deployer'];
            const validProviders = ['gemini', 'claude'];

            if (!validRoles.includes(role)) {
                return NextResponse.json(
                    { error: `Invalid role: ${role}` },
                    { status: 400 }
                );
            }
            if (!validProviders.includes(provider)) {
                return NextResponse.json(
                    { error: `Invalid provider: ${provider}` },
                    { status: 400 }
                );
            }

            await systemConfigService.setLLMRole(role, provider);
            return NextResponse.json({ success: true, role, provider });
        }

        // Handle generic config keys
        if (key && ALLOWED_KEYS.includes(key) && value !== undefined) {
            const isSecret = SECRET_KEYS.includes(key);
            await systemConfigService.setConfig(key, value, isSecret);
            return NextResponse.json({ success: true, key });
        }

        return NextResponse.json(
            { error: 'Invalid request. Expected { key, value } or { key: "llm_role", role, provider }' },
            { status: 400 }
        );
    } catch (error) {
        console.error('Failed to update system config:', error);
        return NextResponse.json(
            { error: 'Failed to update system config' },
            { status: 500 }
        );
    }
}
