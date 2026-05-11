import { useState, useEffect } from 'react';
import { Stars, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';

// ============ 类型定义 ============

/** 天空参数 - 星空类型 */
interface StarsParams {
  radius?: number;
  depth?: number;
  count?: number;
  factor?: number;
  saturation?: number;
  fade?: boolean;
  speed?: number;
}

/** 天空参数 - 渐变类型 */
interface GradientParams {
  colors?: string[];
  topColor?: string;
  bottomColor?: string;
}

/** 天空参数 - 天空盒类型 */
interface SkyboxParams {
  texture?: string;
  mapping?: 'EquirectangularReflectionMapping' | 'CubeReflectionMapping';
}

/** 天空配置 */
interface SkyConfig {
  type: 'stars' | 'gradient' | 'skybox';
  params?: StarsParams | GradientParams | SkyboxParams;
}

/** 地面参数 - 网格类型 */
interface GridParams {
  size?: number;
  cellSize?: number;
  cellThickness?: number;
  cellColor?: string;
  sectionSize?: number;
  sectionColor?: string;
  fadeDistance?: number;
}

/** 地面参数 - 平面类型 */
interface PlaneParams {
  size?: number;
  color?: string;
  texture?: string;
  roughness?: number;
  metalness?: number;
}

/** 地面配置 */
interface GroundConfig {
  type: 'grid' | 'plane';
  params?: GridParams | PlaneParams;
}

/** 环境光配置 */
interface AmbientLightConfig {
  type: 'ambient';
  intensity: number;
  color?: string;
}

/** 平行光配置 */
interface DirectionalLightConfig {
  type: 'directional';
  position?: [number, number, number];
  intensity: number;
  color?: string;
  castShadow?: boolean;
}

/** 点光源配置 */
interface PointLightConfig {
  type: 'point';
  position?: [number, number, number];
  intensity: number;
  color?: string;
  distance?: number;
  decay?: number;
}

/** 灯光配置联合类型 */
type LightConfig = AmbientLightConfig | DirectionalLightConfig | PointLightConfig;

/** 雾效配置 */
interface FogConfig {
  enabled: boolean;
  color?: string;
  near?: number;
  far?: number;
}

/** 辉光配置 */
interface BloomConfig {
  enabled: boolean;
  intensity?: number;
}

/** 特效配置 */
interface EffectsConfig {
  fog?: FogConfig;
  bloom?: BloomConfig;
}

/** 相机配置 */
interface CameraConfig {
  position?: [number, number, number];
  fov?: number;
  minDistance?: number;
  maxDistance?: number;
}

/** 场景元素 */
interface SceneElements {
  sky?: SkyConfig;
  ground?: GroundConfig;
  lights?: LightConfig[];
  effects?: EffectsConfig;
}

/** 场景配置 */
export interface SceneConfig {
  id: string;
  name: string;
  name_en?: string;
  version?: string;
  author?: string;
  description?: string;
  elements: SceneElements;
  camera?: CameraConfig;
}

// 导出类型供外部使用
export type { 
  CameraConfig, 
  EffectsConfig, 
  FogConfig, 
  BloomConfig,
  LightConfig,
  SkyConfig,
  GroundConfig 
};

// ============ 场景加载器 Hook ============

export function useSceneLoader(sceneId: string) {
  const [sceneConfig, setSceneConfig] = useState<SceneConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadScene() {
      try {
        setLoading(true);
        const response = await fetch(`/scenes/${sceneId}.json`);
        if (!response.ok) {
          // 加载默认场景
          const defaultRes = await fetch('/scenes/default.json');
          const defaultConfig = await defaultRes.json();
          setSceneConfig(defaultConfig);
          return;
        }
        const config = await response.json();
        setSceneConfig(config);
        setError(null);
      } catch (e) {
        console.error('Failed to load scene:', e);
        setError(e instanceof Error ? e.message : 'Unknown error');
        // 尝试加载默认场景
        try {
          const defaultRes = await fetch('/scenes/default.json');
          const defaultConfig = await defaultRes.json();
          setSceneConfig(defaultConfig);
        } catch {
          // ignore
        }
      } finally {
        setLoading(false);
      }
    }
    loadScene();
  }, [sceneId]);

  return { sceneConfig, loading, error };
}

// ============ 天空盒纹理加载组件 ============

function SkyboxTexture({ texturePath, mapping }: { texturePath: string; mapping?: string }) {
  const { scene } = useThree();
  
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    loader.load(texturePath, (texture) => {
      if (mapping === 'EquirectangularReflectionMapping') {
        texture.mapping = THREE.EquirectangularReflectionMapping;
      }
      scene.background = texture;
      
      return () => {
        scene.background = null;
        texture.dispose();
      };
    }, undefined, (err) => {
      console.error('Failed to load skybox texture:', err);
    });
  }, [scene, texturePath, mapping]);
  
  return null;
}

// ============ 平面地面组件 ============

function PlaneGround({ params }: { params: PlaneParams }) {
  const { size = 50, color = '#0a0a0a', roughness = 0.8, metalness = 0.2, texture: texturePath } = params;
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const { scene } = useThree();
  
  // 加载纹理
  useEffect(() => {
    if (!texturePath) {
      setTexture(null);
      return;
    }
    
    const loader = new THREE.TextureLoader();
    loader.load(texturePath, (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(size / 10, size / 10);
      setTexture(tex);
    }, undefined, (err) => {
      console.error('Failed to load ground texture:', err);
      setTexture(null);
    });
    
    return () => {
      if (texture) {
        texture.dispose();
      }
    };
  }, [texturePath, size]);
  
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial 
        color={color} 
        roughness={roughness} 
        metalness={metalness}
        map={texture}
      />
    </mesh>
  );
}

// ============ 场景元素渲染组件 ============

export function SceneElements({ config }: { config: SceneConfig }) {
  const { scene } = useThree();
  
  if (!config || !config.elements) {
    return null;
  }
  
  const { sky, ground, lights, effects } = config.elements;

  // 应用雾效
  useEffect(() => {
    if (effects?.fog?.enabled) {
      scene.fog = new THREE.Fog(
        effects.fog.color || '#0f0c29',
        effects.fog.near || 10,
        effects.fog.far || 50
      );
    } else {
      scene.fog = null;
    }
    
    return () => {
      scene.fog = null;
    };
  }, [scene, effects?.fog]);

  // 渲染天空
  const renderSky = () => {
    if (!sky) return null;
    
    if (sky.type === 'stars') {
      const p = (sky.params || {}) as StarsParams;
      return (
        <Stars
          radius={p.radius ?? 100}
          depth={p.depth ?? 50}
          count={p.count ?? 5000}
          factor={p.factor ?? 4}
          saturation={p.saturation ?? 0}
          fade={p.fade ?? true}
          speed={p.speed ?? 1}
        />
      );
    }
    
    if (sky.type === 'gradient') {
      const p = (sky.params || {}) as GradientParams;
      return <color attach="background" args={[p.bottomColor || p.colors?.[0] || '#000000']} />;
    }
    
    if (sky.type === 'skybox') {
      const p = (sky.params || {}) as SkyboxParams;
      if (p.texture) {
        return (
          <SkyboxTexture 
            texturePath={p.texture} 
            mapping={p.mapping}
          />
        );
      }
    }
    
    return null;
  };

  // 渲染地面
  const renderGround = () => {
    if (!ground) return null;
    
    if (ground.type === 'grid') {
      const p = (ground.params || {}) as GridParams;
      return (
        <Grid
          position={[0, -0.5, 0]}
          args={[p.size ?? 30, p.size ?? 30]}
          cellSize={p.cellSize ?? 1}
          cellThickness={p.cellThickness ?? 0.5}
          cellColor={p.cellColor ?? '#1e1e2e'}
          sectionSize={p.sectionSize ?? 5}
          sectionColor={p.sectionColor ?? '#2e2e4e'}
          fadeDistance={p.fadeDistance ?? 50}
        />
      );
    }
    
    if (ground.type === 'plane') {
      const p = (ground.params || {}) as PlaneParams;
      return <PlaneGround params={p} />;
    }
    
    return null;
  };

  // 渲染灯光
  const renderLights = () => {
    if (!lights || !Array.isArray(lights)) return null;
    
    return lights.map((light, index) => {
      if (light.type === 'ambient') {
        const al = light as AmbientLightConfig;
        return (
          <ambientLight
            key={index}
            intensity={al.intensity}
            color={al.color ?? '#ffffff'}
          />
        );
      }
      
      if (light.type === 'directional') {
        const dl = light as DirectionalLightConfig;
        return (
          <directionalLight
            key={index}
            position={dl.position ?? [10, 10, 5]}
            intensity={dl.intensity}
            color={dl.color ?? '#ffffff'}
            castShadow={dl.castShadow ?? false}
          />
        );
      }
      
      if (light.type === 'point') {
        const pl = light as PointLightConfig;
        return (
          <pointLight
            key={index}
            position={pl.position ?? [0, 5, 0]}
            intensity={pl.intensity}
            color={pl.color ?? '#ffffff'}
            distance={pl.distance ?? 0}
            decay={pl.decay ?? 2}
          />
        );
      }
      
      return null;
    });
  };

  return (
    <>
      {renderSky()}
      {renderGround()}
      {renderLights()}
    </>
  );
}

// ============ 导出相机配置 Hook ============

/** 获取相机配置的默认值 */
export function getCameraConfig(config?: CameraConfig): {
  position: [number, number, number];
  fov: number;
  minDistance: number;
  maxDistance: number;
} {
  return {
    position: config?.position ?? [15, 12, 15],
    fov: config?.fov ?? 50,
    minDistance: config?.minDistance ?? 3,
    maxDistance: config?.maxDistance ?? 50,
  };
}

export default { useSceneLoader, SceneElements, getCameraConfig };