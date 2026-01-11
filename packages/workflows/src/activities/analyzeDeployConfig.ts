/**
 * AI Swarm v3.0.0 - Analyze Deploy Config Activity
 * 
 * LLM-driven activity to analyze a project and generate deployment configuration.
 * Writes ai-swarm.deploy.yaml to the project root.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger, logActivityStart, logActivityComplete, invokeLLM } from '@ai-swarm/shared';
import type { DeployConfig, DeployMode } from '@ai-swarm/shared';
import { deployConfigService } from '@ai-swarm/shared';

// =============================================================================
// TYPES
// =============================================================================

export interface AnalyzeDeployConfigInput {
    projectDir: string;
    projectId?: string;
}

export interface AnalyzeDeployConfigOutput {
    config: DeployConfig;
    analysis: string;
    savedToFile: boolean;
    error?: string;
}

// =============================================================================
// ACTIVITY
// =============================================================================

/**
 * Analyze a project to determine deployment configuration.
 * Uses LLM to examine project files and generate appropriate config.
 */
export async function analyzeDeployConfig(
    input: AnalyzeDeployConfigInput
): Promise<AnalyzeDeployConfigOutput> {
    const startTime = Date.now();
    logActivityStart('deployer', 'analyzeDeployConfig', { projectDir: input.projectDir });

    try {
        const { projectDir } = input;

        // Gather project context
        const context = await gatherProjectContext(projectDir);

        // Build LLM prompt
        const prompt = buildAnalysisPrompt(context);

        // Call LLM
        const llmResponse = await invokeLLM(prompt, { role: 'deployer' });

        // Parse response
        const analysisResult = parseAnalysisResponse(llmResponse);

        // Build full config
        const config = buildConfigFromAnalysis(analysisResult);

        // Write to file
        let savedToFile = false;
        try {
            await deployConfigService.writeConfigFile(projectDir, config);
            savedToFile = true;
            logger.info({ projectDir }, 'Wrote ai-swarm.deploy.yaml from LLM analysis');
        } catch (writeError) {
            logger.warn({ error: writeError, projectDir }, 'Failed to write deploy config file');
        }

        logActivityComplete('deployer', 'analyzeDeployConfig', Date.now() - startTime, true);

        return {
            config,
            analysis: analysisResult.analysis,
            savedToFile,
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMsg }, 'analyzeDeployConfig failed');
        logActivityComplete('deployer', 'analyzeDeployConfig', Date.now() - startTime, false);

        // Return default config on failure
        return {
            config: deployConfigService.getDefaultDeployConfig(),
            analysis: 'LLM analysis failed, using defaults',
            savedToFile: false,
            error: errorMsg,
        };
    }
}

// =============================================================================
// HELPERS
// =============================================================================

interface ProjectContext {
    hasDockerCompose: boolean;
    hasDockerfile: boolean;
    hasPackageJson: boolean;
    hasGitFolder: boolean;
    dockerComposeServices: string[];
    projectType: string;
    buildScript?: string;
}

async function gatherProjectContext(projectDir: string): Promise<ProjectContext> {
    const context: ProjectContext = {
        hasDockerCompose: false,
        hasDockerfile: false,
        hasPackageJson: false,
        hasGitFolder: false,
        dockerComposeServices: [],
        projectType: 'unknown',
    };

    // Check for docker-compose.yml
    const dockerComposePath = join(projectDir, 'docker-compose.yml');
    if (existsSync(dockerComposePath)) {
        context.hasDockerCompose = true;
        try {
            const content = readFileSync(dockerComposePath, 'utf-8');
            // Simple regex to extract service names
            const serviceMatches = content.match(/^\s{2}(\w[\w-]*):$/gm);
            if (serviceMatches) {
                context.dockerComposeServices = serviceMatches.map(s => s.trim().replace(':', ''));
            }
        } catch {
            // Ignore read errors
        }
    }

    // Check for Dockerfile
    context.hasDockerfile = existsSync(join(projectDir, 'Dockerfile'));

    // Check for .git
    context.hasGitFolder = existsSync(join(projectDir, '.git'));

    // Check for package.json
    const packageJsonPath = join(projectDir, 'package.json');
    if (existsSync(packageJsonPath)) {
        context.hasPackageJson = true;
        context.projectType = 'nodejs';
        try {
            const content = readFileSync(packageJsonPath, 'utf-8');
            const pkg = JSON.parse(content);
            if (pkg.scripts?.build) {
                context.buildScript = pkg.scripts.build;
            }
        } catch {
            // Ignore parse errors
        }
    }

    // Check for other project types
    if (existsSync(join(projectDir, 'go.mod'))) {
        context.projectType = 'go';
    } else if (existsSync(join(projectDir, 'Cargo.toml'))) {
        context.projectType = 'rust';
    } else if (existsSync(join(projectDir, 'requirements.txt')) || existsSync(join(projectDir, 'pyproject.toml'))) {
        context.projectType = 'python';
    }

    return context;
}

function buildAnalysisPrompt(context: ProjectContext): string {
    return `You are analyzing a project to determine deployment configuration.

PROJECT CONTEXT:
- Has docker-compose.yml: ${context.hasDockerCompose}
- Has Dockerfile: ${context.hasDockerfile}
- Has .git folder: ${context.hasGitFolder}
- Has package.json: ${context.hasPackageJson}
- Project type: ${context.projectType}
- Docker Compose services: ${context.dockerComposeServices.join(', ') || 'none detected'}
- Build script: ${context.buildScript || 'none'}

QUESTION 1: What deployment mode should this project use?
- "git-direct": Deploy directly to the server (git pull + docker compose up). Good for projects where the deploy directory IS the git repository.
- "rsync": Sync from a local build to a separate deploy folder. Good when source and build are separate.

QUESTION 2: What Docker services should be rebuilt during deployment?
List specific services or leave empty for all.

QUESTION 3: What is the best deploy command for this project?
Consider the project type and available tools.

Respond in this exact JSON format:
{
  "mode": "git-direct" or "rsync",
  "services": ["service1", "service2"] or [],
  "deployCommand": "docker compose up -d --build",
  "buildCommand": "npm run build" or "",
  "analysis": "Brief explanation of your reasoning"
}`;
}

interface AnalysisResult {
    mode: DeployMode;
    services: string[];
    deployCommand: string;
    buildCommand: string;
    analysis: string;
}

function parseAnalysisResponse(response: string): AnalysisResult {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        logger.warn('Could not extract JSON from LLM response, using defaults');
        return {
            mode: 'git-direct',
            services: [],
            deployCommand: 'docker compose up -d --build',
            buildCommand: '',
            analysis: 'Failed to parse LLM response',
        };
    }

    try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            mode: parsed.mode || 'git-direct',
            services: Array.isArray(parsed.services) ? parsed.services : [],
            deployCommand: parsed.deployCommand || 'docker compose up -d --build',
            buildCommand: parsed.buildCommand || '',
            analysis: parsed.analysis || 'LLM analysis complete',
        };
    } catch {
        logger.warn('Failed to parse LLM JSON response, using defaults');
        return {
            mode: 'git-direct',
            services: [],
            deployCommand: 'docker compose up -d --build',
            buildCommand: '',
            analysis: 'Failed to parse LLM response',
        };
    }
}

function buildConfigFromAnalysis(analysis: AnalysisResult): DeployConfig {
    return {
        version: '1',
        mode: analysis.mode,
        build: {
            base: '.',
            command: analysis.buildCommand,
            outputDir: 'dist',
        },
        deploy: {
            services: analysis.services,
            preCommand: '',
            command: analysis.deployCommand,
            postCommand: '',
        },
        verify: {
            browserTest: false,
            healthUrl: '',
        },
    };
}
