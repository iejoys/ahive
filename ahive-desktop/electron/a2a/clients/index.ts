/**
 * A2A 客户端模块导出
 */

// 接口
export type {
  IA2AClient,
  IA2AClientFactory,
  StreamCallback,
  A2AStreamEvent,
  A2AStreamEventData,
  A2AStreamEventType,
  TextDelta,
  TaskStatusUpdate,
  TaskArtifactUpdate,
  AgentMessage,
  MessagePart,
  ErrorInfo
} from './IA2AClient';

// 客户端实现
export { BaseA2AClient } from './BaseA2AClient';
export { A2AStandardClient } from './A2AStandardClient';
export { OpenClawClient } from './OpenClawClient';
export { GenericA2AClient } from './GenericA2AClient';
export { AHIVECoreClient } from './AHIVECoreClient';

// 工厂
export { 
  A2AClientFactory, 
  a2aClientFactory, 
  type A2AProtocolType,
  type ClientCreationOptions
} from './A2AClientFactory';

// 配置相关
export { A2AProtocolLoader } from '../config/A2AProtocolLoader';
export { A2ARequestBuilder } from '../config/A2ARequestBuilder';
export { A2AResponseParser } from '../config/A2AResponseParser';
export type {
  A2AProtocolConfig,
  A2AProtocolRegistry,
  RequestContext,
  ParsedRequest,
  ParsedResponse,
  SSEEventData
} from '../config/A2AProtocolConfig';
