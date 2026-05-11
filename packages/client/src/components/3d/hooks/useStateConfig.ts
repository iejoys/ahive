import { useStore } from '../../../store/useStore';
import type { Agent } from '../../../types';

/**
 * 眼睛形状类型
 */
export type EyeShape = 'open' | 'half-open' | 'closed' | 'x';
export type EyeExpression = 'calm' | 'focused' | 'sleepy' | 'error' | 'none';

/**
 * 眼睛配置
 */
export interface EyeConfig {
  shape: EyeShape;
  expression: EyeExpression;
  glow: boolean;
  scanLine?: boolean;
  color?: string;
}

/**
 * 核心灯配置
 */
export interface CoreConfig {
  glow: boolean;
  pulseSpeed: number;
  color: string;
  fillAnimation?: boolean;
}

/**
 * 浮动动画配置
 */
export interface FloatAnimation {
  enabled: boolean;
  amplitude: number;
  period: number;
}

/**
 * 旋转动画配置
 */
export interface RotateAnimation {
  speed: number;
}

/**
 * 摆动动画配置
 */
export interface SwayAnimation {
  enabled: boolean;
  angle: number;
  period: number;
}

/**
 * 抖动动画配置
 */
export interface ShakeAnimation {
  enabled: boolean;
  amplitude: number;
  period: number;
}

/**
 * 动画配置
 */
export interface AnimationConfig {
  float?: FloatAnimation | false;
  rotate?: boolean | RotateAnimation;
  sway?: SwayAnimation;
  shake?: ShakeAnimation;
}

/**
 * 粒子配置
 */
export interface ParticleConfig {
  enabled: boolean;
  direction: 'up' | 'down';
  count: number;
}

/**
 * 光环配置
 */
export interface HaloConfig {
  enabled: boolean;
  speed: number;
  opacity: number;
}

/**
 * 完整状态配置
 */
export interface StateConfig {
  color: string;
  emissive: string;
  emissiveIntensity: number | { min: number; max: number };
  opacity: number;
  
  eyes: EyeConfig;
  core: CoreConfig;
  animation: AnimationConfig;
  
  particles: boolean | ParticleConfig;
  halo: HaloConfig;
  
  sleepIcon?: boolean;
  warningRipple?: boolean;
  
  isOffline: boolean;
  interactive: boolean;
}

/**
 * ============================================
 * 深海系配色方案（深海蓝主调）
 * ============================================
 * 
 * 特点：深海蓝主调 + 幽深宁静 + 科技神秘
 * 深色背景 + 青色/蓝色发光 + 珊瑚色警告
 */
 
/**
 * 基础颜色 - 深海系
 */
export const BASE_COLOR = '#0A1628';          // 深海黑蓝
export const BASE_EMISSIVE = '#4ECDC4';       // 深海青

/**
 * 工作状态 - 海洋脉冲
 */
export const WORKING_COLOR = '#0D2137';
export const WORKING_EMISSIVE = '#00D9FF';

/**
 * 暂停状态 - 浅海波光
 */
export const PAUSED_COLOR = '#0D2137';
export const PAUSED_EMISSIVE = '#45B7D1';

/**
 * 错误状态 - 珊瑚警报
 */
export const ERROR_COLOR = '#0A1628';
export const ERROR_EMISSIVE = '#FF6B9D';

/**
 * 离线状态 - 深海寂静
 */
export const OFFLINE_COLOR = '#0D2137';
export const OFFLINE_EMISSIVE = '#2C3E50';

/**
 * 状态颜色常量（兼容）
 */
export const STATUS_COLORS = {
  idle: BASE_COLOR,
  working: WORKING_COLOR,
  paused: PAUSED_COLOR,
  error: ERROR_COLOR,
  offline: OFFLINE_COLOR,
} as const;

/**
 * 完整状态配置表
 */
const STATE_CONFIGS: Record<string, Omit<StateConfig, 'isOffline' | 'interactive'>> = {
  // ===== 空闲状态 - 深海幽光 =====
  idle: {
    color: BASE_COLOR,
    emissive: BASE_EMISSIVE,
    emissiveIntensity: { min: 0.3, max: 0.6 },
    opacity: 1.0,
    
    eyes: {
      shape: 'open',
      expression: 'calm',
      glow: false,
    },
    
    core: {
      glow: true,
      pulseSpeed: 3,
      color: BASE_EMISSIVE,
    },
    
    animation: {
      float: { enabled: true, amplitude: 0.05, period: 2 },
      rotate: false,
    },
    
    particles: false,
    halo: { enabled: true, speed: 0, opacity: 0.4 },
  },
  
  // ===== 工作状态 - 海洋脉冲 =====
  working: {
    color: WORKING_COLOR,
    emissive: WORKING_EMISSIVE,
    emissiveIntensity: { min: 0.6, max: 1.0 },
    opacity: 1.0,
    
    eyes: {
      shape: 'open',
      expression: 'focused',
      glow: true,
    },
    
    core: {
      glow: true,
      pulseSpeed: 0.5,
      color: WORKING_EMISSIVE,
      fillAnimation: true,
    },
    
    animation: {
      float: { enabled: true, amplitude: 0.03, period: 1.5 },
      rotate: { speed: 0.02 },
    },
    
    particles: {
      enabled: true,
      direction: 'up',
      count: 30,
    },
    halo: { enabled: true, speed: 0.5, opacity: 0.6 },
  },
  
  // ===== 暂停状态 - 浅海波光 =====
  paused: {
    color: PAUSED_COLOR,
    emissive: PAUSED_EMISSIVE,
    emissiveIntensity: { min: 0.3, max: 0.5 },
    opacity: 1.0,
    
    eyes: {
      shape: 'half-open',
      expression: 'sleepy',
      glow: false,
    },
    
    core: {
      glow: true,
      pulseSpeed: 2,
      color: PAUSED_EMISSIVE,
    },
    
    animation: {
      float: { enabled: true, amplitude: 0.02, period: 4 },
      rotate: false,
      sway: { enabled: true, angle: 5, period: 4 },
    },
    
    particles: false,
    halo: { enabled: true, speed: 0, opacity: 0.35 },
    sleepIcon: true,
  },
  
  // ===== 错误状态 - 珊瑚警报 =====
  error: {
    color: ERROR_COLOR,
    emissive: ERROR_EMISSIVE,
    emissiveIntensity: { min: 0.6, max: 1.0 },
    opacity: 1.0,
    
    eyes: {
      shape: 'x',
      expression: 'error',
      glow: true,
      color: ERROR_EMISSIVE,
    },
    
    core: {
      glow: true,
      pulseSpeed: 0.3,
      color: ERROR_EMISSIVE,
    },
    
    animation: {
      float: false,
      rotate: false,
      shake: { enabled: true, amplitude: 0.02, period: 0.1 },
    },
    
    particles: false,
    halo: { enabled: true, speed: 0, opacity: 0.6 },
    warningRipple: true,
  },
  
  // ===== 离线状态 - 深海寂静 =====
  offline: {
    color: OFFLINE_COLOR,
    emissive: OFFLINE_EMISSIVE,
    emissiveIntensity: 0.2,
    opacity: 1.0,
    
    eyes: {
      shape: 'closed',
      expression: 'none',
      glow: false,
    },
    
    core: {
      glow: true,
      color: OFFLINE_EMISSIVE,
      pulseSpeed: 3,
    },
    
    animation: {
      float: { enabled: true, amplitude: 0.02, period: 3 },
      rotate: false,
    },
    
    particles: false,
    halo: { enabled: true, speed: 0, opacity: 0.2 },
  },
};

/**
 * 获取智能体状态配置
 */
export function useStateConfig(agent: Agent): StateConfig {
  const offlineAgents = useStore(s => s.offlineAgents);
  const isOffline = offlineAgents.has(agent.id);
  
  if (isOffline) {
    return {
      ...STATE_CONFIGS.offline,
      isOffline: true,
      interactive: false,
    };
  }
  
  const statusConfig = STATE_CONFIGS[agent.status] || STATE_CONFIGS.idle;
  
  return {
    ...statusConfig,
    isOffline: false,
    interactive: true,
  };
}

/**
 * 获取状态配置（非 hook 版本）
 */
export function getStateConfig(agent: Agent, offlineAgents: Set<string>): StateConfig {
  const isOffline = offlineAgents.has(agent.id);
  
  if (isOffline) {
    return {
      ...STATE_CONFIGS.offline,
      isOffline: true,
      interactive: false,
    };
  }
  
  const statusConfig = STATE_CONFIGS[agent.status] || STATE_CONFIGS.idle;
  
  return {
    ...statusConfig,
    isOffline: false,
    interactive: true,
  };
}

/**
 * 获取当前发光强度
 */
export function getEmissiveIntensity(
  config: StateConfig, 
  time: number
): number {
  const { emissiveIntensity } = config;
  
  if (typeof emissiveIntensity === 'number') {
    return emissiveIntensity;
  }
  
  const { min, max } = emissiveIntensity;
  const pulseSpeed = config.core.pulseSpeed || 3;
  const phase = (Math.sin(time * Math.PI * 2 / pulseSpeed) + 1) / 2;
  
  return min + (max - min) * phase;
}

export default useStateConfig;