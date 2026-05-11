// Hooks
export { 
  useStateConfig, 
  getStateConfig, 
  getEmissiveIntensity,
  STATUS_COLORS,
  BASE_COLOR,
  BASE_EMISSIVE,
  WORKING_COLOR,
  WORKING_EMISSIVE,
  PAUSED_COLOR,
  PAUSED_EMISSIVE,
  ERROR_COLOR,
  ERROR_EMISSIVE,
  OFFLINE_COLOR,
  OFFLINE_EMISSIVE
} from './useStateConfig';

// Types
export type {
  EyeShape,
  EyeExpression,
  EyeConfig,
  CoreConfig,
  FloatAnimation,
  RotateAnimation,
  SwayAnimation,
  ShakeAnimation,
  AnimationConfig,
  ParticleConfig,
  HaloConfig,
  StateConfig,
} from './useStateConfig';