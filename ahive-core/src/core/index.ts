/**
 * Core module exports
 */

export { App } from './app.js';
export type { AppConfig } from './types.js';
export { createContextManager, ContextManager } from './context.js';
export type { RequestContext } from './context.js';

// AHIVECORE 核心智能体
export { AHIVECore, getAHIVECore, initializeAHIVECore } from './ahivecore.js';
export type { AHIVECoreConfig, DynamicInjectionData } from './ahivecore.js';