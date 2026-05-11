import { useStore } from '../../store/useStore';
import { translations } from '../../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SceneSelector } from './SceneSelector';

interface HeaderProps {
  currentScene: string;
  onSceneChange: (scene: string) => void;
}

export function Header({ currentScene, onSceneChange }: HeaderProps) {
  const { agents, tasks, language } = useStore();
  const tr = translations[language];
  
  const workingAgents = agents.filter(a => a.status === 'working').length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;

  return (
    <header className="h-14 bg-hive-surface border-b border-hive-border flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-hive-text">🤖 {tr.appName}</h1>
        <span className="text-hive-text-secondary text-sm">{tr.appSubtitle}</span>
      </div>
      
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          <span className="text-sm text-hive-text-secondary">
            {tr.workingAgents}: <span className="text-hive-text font-medium">{workingAgents}</span>
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-sm text-hive-text-secondary">
            {tr.completedTasks}: <span className="text-hive-text font-medium">{completedTasks}</span>
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-sm text-hive-text-secondary">
            {tr.totalAgents}: <span className="text-hive-text font-medium">{agents.length}</span>
          </span>
        </div>

        <SceneSelector currentScene={currentScene} onSceneChange={onSceneChange} language={language} />
        
        <LanguageSwitcher />
      </div>
    </header>
  );
}
