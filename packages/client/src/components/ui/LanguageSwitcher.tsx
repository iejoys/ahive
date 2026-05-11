import { useStore } from '../../store/useStore';

export function LanguageSwitcher() {
  const { language, setLanguage } = useStore();

  const toggle = () => {
    setLanguage(language === 'zh' ? 'en' : 'zh');
  };

  return (
    <button
      onClick={toggle}
      className="px-2 py-1 text-sm rounded border border-hive-border text-hive-text-secondary hover:bg-hive-hover transition-colors"
    >
      {language === 'zh' ? 'EN' : '中'}
    </button>
  );
}
