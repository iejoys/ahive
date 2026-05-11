import { useState, useEffect } from 'react';

interface SceneInfo {
  id: string;
  name: string;
  name_en: string;
  thumbnail: string;
  version: string;
  author?: string;
  description?: string;
}

interface SceneSelectorProps {
  currentScene: string;
  onSceneChange: (sceneId: string) => void;
  language?: string;
}

export function SceneSelector({ currentScene, onSceneChange, language = 'zh' }: SceneSelectorProps) {
  const isZh = language === 'zh';
  const [scenes, setScenes] = useState<SceneInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [thumbnailErrors, setThumbnailErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/scenes/index.json')
      .then(res => res.json())
      .then(data => setScenes(data.scenes || []))
      .catch(err => console.error('Failed to load scenes:', err))
      .finally(() => setLoading(false));
  }, []);

  const current = scenes.find(s => s.id === currentScene);

  // 处理缩略图加载错误
  const handleThumbnailError = (sceneId: string) => {
    setThumbnailErrors(prev => new Set(prev).add(sceneId));
  };

  // 获取缩略图 URL
  const getThumbnailUrl = (scene: SceneInfo): string => {
    if (!scene.thumbnail || thumbnailErrors.has(scene.id)) {
      // 根据场景 ID 生成不同的默认图标
      return getDefaultThumbnail(scene.id);
    }
    return scene.thumbnail;
  };

  // 根据场景 ID 生成默认缩略图
  const getDefaultThumbnail = (sceneId: string): string => {
    const colors: Record<string, { primary: string; secondary: string; accent: string }> = {
      default: { primary: '#1e1b4b', secondary: '#312e81', accent: '#818cf8' },
      cyberpunk: { primary: '#0f0c29', secondary: '#302b63', accent: '#ff00ff' },
      office: { primary: '#1a1a2e', secondary: '#2d2d44', accent: '#6366f1' },
      nature: { primary: '#1a3c1a', secondary: '#2d5a2d', accent: '#4ade80' },
    };
    
    const color = colors[sceneId] || colors.default;
    
    return `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <rect width="32" height="32" fill="${color.primary}"/>
  <circle cx="16" cy="16" r="8" fill="${color.secondary}" stroke="${color.accent}" stroke-width="0.5"/>
  <circle cx="16" cy="16" r="4" fill="${color.accent}"/>
  <circle cx="16" cy="16" r="2" fill="${color.primary}"/>
</svg>
`)}`;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white text-sm"
        title={isZh ? '切换场景' : 'Switch Scene'}
      >
        <span>🎨</span>
        <span>{current?.name || (isZh ? '选择场景' : 'Select Scene')}</span>
        <span className="text-gray-400">▼</span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50">
          <div className="p-2 border-b border-gray-700">
            <div className="text-xs text-gray-500 px-2 py-1">
              {loading ? (isZh ? '加载中...' : 'Loading...') : `${scenes.length} ${isZh ? '个场景' : 'scenes'}`}
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {scenes.map(scene => (
              <button
                key={scene.id}
                onClick={() => {
                  onSceneChange(scene.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  scene.id === currentScene 
                    ? 'bg-indigo-600 text-white' 
                    : 'hover:bg-gray-800 text-gray-200'
                }`}
              >
                {/* 缩略图 */}
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-700 flex-shrink-0 border border-gray-600">
                  <img
                    src={getThumbnailUrl(scene)}
                    alt={scene.name}
                    className="w-full h-full object-cover"
                    onError={() => handleThumbnailError(scene.id)}
                  />
                </div>
                
                {/* 场景信息 */}
                <div className="text-left flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {isZh ? scene.name : (scene.name_en || scene.name)}
                  </div>
                  <div className="text-xs text-gray-500 flex items-center gap-2">
                    <span>v{scene.version}</span>
                    {scene.author && (
                      <>
                        <span>•</span>
                        <span>{scene.author}</span>
                      </>
                    )}
                  </div>
                  {scene.description && (
                    <div className="text-xs text-gray-600 truncate mt-0.5">
                      {scene.description}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
          
          {/* 场景开发提示 */}
          <div className="p-2 border-t border-gray-700 text-center">
            <a 
              href="#" 
              className="text-xs text-gray-500 hover:text-indigo-400"
              onClick={(e) => {
                e.preventDefault();
                // 可以打开场景开发指南
                alert(isZh ? '场景开发指南请查看 doc/SCENE_DEVELOPMENT_GUIDE.md' : 'See doc/SCENE_DEVELOPMENT_GUIDE.md');
              }}
            >
              {isZh ? '📚 场景开发指南' : '📚 Scene Dev Guide'}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default SceneSelector;