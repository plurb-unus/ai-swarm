/**
 * AI Swarm v2 - Shared Package Entry Point
 */

export * from './types.js';
export * from './llm.js';
export * from './logger.js';
export * from './gemini-manager.js';
export * from './scm/index.js';
export * from './services/ProjectService.js';
export * from './services/PromptService.js';
export * from './services/WorkerHealthService.js';  // v3.0.0
export * from './services/SystemConfigService.js';  // v3.0.0: Claude auth mode
export * from './constants.js';
export * from './services/SystemStatusService.js';  // v3.0.0: System status
export * from './context-discovery.js';
export * from './db/seed.js';
export * from './db.js';  // v3.0.0: Singleton DB pool

// v3.0.0: Sovereign Auth services
export * from './services/AuthChallengeService.js';
export * from './services/MagicLinkService.js';
export * from './services/PasskeyService.js';

// v3.0.0: Declarative Deployment Config
export * from './services/DeployConfigService.js';
