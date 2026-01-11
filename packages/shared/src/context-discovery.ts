/**
 * AI Swarm v3.0.0 - Context Discovery Utility
 * 
 * Searches for project context folders and files dynamically.
 * Used by both Portal and Workers to load project documentation.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from './logger.js';

// Common context folder patterns to search
const CONTEXT_FOLDER_CANDIDATES = [
    '.aicontext',
    'docs/context',
    '.context',
    'context',
    'docs',
];

// Context files to look for (in order of preference)
const CONTEXT_FILE_CANDIDATES = [
    'README.md',
    'CLAUDE.md',
    'SYSTEM.md',
    'CONTEXT.md',
];

export interface ContextDiscoveryResult {
    found: boolean;
    folder?: string;
    file?: string;
    fullPath?: string;
}

/**
 * Discover the context folder for a project.
 * Checks AI_CONTEXT_FOLDER env var first, then searches common locations.
 */
export async function discoverContextFolder(projectDir: string): Promise<ContextDiscoveryResult> {
    // If explicitly configured, use that
    const configuredFolder = process.env.AI_CONTEXT_FOLDER;

    if (configuredFolder) {
        const configuredPath = path.join(projectDir, configuredFolder);
        try {
            const stat = await fs.stat(configuredPath);
            if (stat.isDirectory()) {
                // Find the best context file in this folder
                for (const contextFile of CONTEXT_FILE_CANDIDATES) {
                    const filePath = path.join(configuredPath, contextFile);
                    try {
                        await fs.access(filePath);
                        return {
                            found: true,
                            folder: configuredFolder,
                            file: contextFile,
                            fullPath: filePath,
                        };
                    } catch {
                        // File doesn't exist, try next
                    }
                }
            }
        } catch {
            logger.warn({ folder: configuredFolder }, 'Configured AI_CONTEXT_FOLDER not found');
        }
    }

    // Search for common context folder patterns
    for (const candidate of CONTEXT_FOLDER_CANDIDATES) {
        const candidatePath = path.join(projectDir, candidate);
        try {
            const stat = await fs.stat(candidatePath);
            if (stat.isDirectory()) {
                // Check for any context file
                for (const contextFile of CONTEXT_FILE_CANDIDATES) {
                    const filePath = path.join(candidatePath, contextFile);
                    try {
                        await fs.access(filePath);
                        return {
                            found: true,
                            folder: candidate,
                            file: contextFile,
                            fullPath: filePath,
                        };
                    } catch {
                        // File doesn't exist, try next
                    }
                }
            }
        } catch {
            // Folder doesn't exist, try next
        }
    }

    return { found: false };
}

/**
 * Load project context content from the discovered context folder.
 */
export async function loadProjectContext(projectDir: string): Promise<string> {
    const discovery = await discoverContextFolder(projectDir);

    if (!discovery.found || !discovery.fullPath) {
        logger.warn({ projectDir }, 'No context folder found in project');
        return '';
    }

    try {
        const content = await fs.readFile(discovery.fullPath, 'utf-8');
        return `\n\n## Project Context (${discovery.folder}/${discovery.file})\n${content}`;
    } catch (error) {
        logger.warn({ path: discovery.fullPath, error }, 'Failed to read context file');
        return '';
    }
}

/**
 * Get the context folder path for include directories.
 * Returns the full path to the context folder, or undefined if not found.
 */
export async function getContextFolderPath(projectDir: string): Promise<string | undefined> {
    const discovery = await discoverContextFolder(projectDir);

    if (discovery.found && discovery.folder) {
        return path.join(projectDir, discovery.folder);
    }

    return undefined;
}
