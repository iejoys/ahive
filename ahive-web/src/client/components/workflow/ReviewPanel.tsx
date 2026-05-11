import { useState } from 'react';
import { useStore } from '../../store/useStore';
import type { Review } from '../../types';

interface ReviewPanelProps {
  taskId: string;
  nodeId: string;
  workflowId: string;
  onSubmit: (review: Review) => void;
  onClose: () => void;
}

export function ReviewPanel({ taskId, nodeId, workflowId, onSubmit, onClose }: ReviewPanelProps) {
  const { language } = useStore();
  
  const [scoreType, setScoreType] = useState<'score' | 'stars'>('score');
  const [score, setScore] = useState(100);
  const [stars, setStars] = useState(5);
  const [feedback, setFeedback] = useState('');
  
  const t = {
    zh: {
      title: '审核评分',
      scoreType: '评分方式',
      score: '分数 (0-100)',
      stars: '星级 (1-5)',
      scoreLabel: '分数',
      feedback: '审核意见',
      feedbackPlaceholder: '请输入审核意见或修改建议...',
      approve: '通过',
      reject: '退回修改',
      cancel: '取消',
    },
    en: {
      title: 'Review',
      scoreType: 'Score Type',
      score: 'Score (0-100)',
      stars: 'Stars (1-5)',
      scoreLabel: 'Score',
      feedback: 'Feedback',
      feedbackPlaceholder: 'Enter review comments or suggestions...',
      approve: 'Approve',
      reject: 'Request Changes',
      cancel: 'Cancel',
    },
  }[language];
  
  const handleSubmit = (status: 'approved' | 'rejected') => {
    const review: Review = {
      id: `review-${Date.now()}`,
      workflowId,
      taskId,
      nodeId,
      score: scoreType === 'score' ? score : undefined,
      stars: scoreType === 'stars' ? stars : undefined,
      feedback,
      status,
      createdAt: new Date().toISOString(),
      reviewedAt: new Date().toISOString(),
    };
    
    onSubmit(review);
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 w-[480px] shadow-2xl border border-gray-700">
        <h2 className="text-xl text-white font-medium mb-4">{t.title}</h2>
        
        {/* 评分类型选择 */}
        <div className="mb-4">
          <label className="text-gray-400 text-sm block mb-2">{t.scoreType}</label>
          <div className="flex gap-2">
            <button
              onClick={() => setScoreType('score')}
              className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
                scoreType === 'score'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              📊 {t.score}
            </button>
            <button
              onClick={() => setScoreType('stars')}
              className={`flex-1 py-2 rounded-lg text-sm transition-colors ${
                scoreType === 'stars'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              ⭐ {t.stars}
            </button>
          </div>
        </div>
        
        {/* 分数/星级输入 */}
        <div className="mb-4">
          <label className="text-gray-400 text-sm block mb-2">
            {scoreType === 'score' ? t.score : t.scoreLabel}
          </label>
          
          {scoreType === 'score' ? (
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0"
                max="100"
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
                className="flex-1"
              />
              <div className={`text-2xl font-bold w-16 text-center ${
                score >= 80 ? 'text-green-400' : score >= 60 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {score}
              </div>
            </div>
          ) : (
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setStars(s)}
                  className="text-3xl transition-transform hover:scale-110"
                >
                  {s <= stars ? '⭐' : '☆'}
                </button>
              ))}
            </div>
          )}
          
          {/* 快捷按钮 */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => scoreType === 'score' ? setScore(100) : setStars(5)}
              className="text-xs bg-green-600/20 text-green-400 px-3 py-1 rounded hover:bg-green-600/30"
            >
              ✓ 100分 / 5星
            </button>
            <button
              onClick={() => scoreType === 'score' ? setScore(60) : setStars(3)}
              className="text-xs bg-yellow-600/20 text-yellow-400 px-3 py-1 rounded hover:bg-yellow-600/30"
            >
              ~ 60分 / 3星
            </button>
            <button
              onClick={() => scoreType === 'score' ? setScore(30) : setStars(1)}
              className="text-xs bg-red-600/20 text-red-400 px-3 py-1 rounded hover:bg-red-600/30"
            >
              ✗ 30分 / 1星
            </button>
          </div>
        </div>
        
        {/* 审核意见 */}
        <div className="mb-6">
          <label className="text-gray-400 text-sm block mb-2">{t.feedback}</label>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={t.feedbackPlaceholder}
            className="w-full h-24 bg-gray-700 text-white text-sm rounded-lg px-3 py-2 border border-gray-600 resize-none"
          />
        </div>
        
        {/* 按钮组 */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg transition-colors"
          >
            {t.cancel}
          </button>
          <button
            onClick={() => handleSubmit('rejected')}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg transition-colors"
          >
            {t.reject}
          </button>
          <button
            onClick={() => handleSubmit('approved')}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg transition-colors"
          >
            {t.approve}
          </button>
        </div>
      </div>
    </div>
  );
}
