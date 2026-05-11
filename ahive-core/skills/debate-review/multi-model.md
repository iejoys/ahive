# 多模型辩论评审

不同大模型有不同"性格"和优势，让它们辩论能产生真正的智力差异。

## 为什么需要多模型

| 模型 | 特点 | 适合角色 |
|------|------|----------|
| **GPT-4** | 全面、逻辑强、创意好 | 策划、提案者 |
| **Claude** | 谨慎、细节、安全意识强 | 质疑者、审核者 |
| **Qwen** | 中文理解好、实用主义 | 本地化、务实派 |
| **DeepSeek** | 代码强、性价比高 | 技术评估 |
| **Gemini** | 多模态、数据强 | 数据分析 |

## 多模型辩论配置

```typescript
// debate-config.ts
export const DEBATE_ROLES = {
  proponent: {
    role: 'proponent',
    systemPrompt: `你是策划智能体，负责提出方案。
特点：乐观、创新、敢想敢做。
职责：提出方案，用数据和逻辑支撑，回应质疑。`,
    model: {
      provider: 'openai',
      name: 'gpt-4',
      temperature: 0.8  // 高创意
    }
  },
  
  opponent: {
    role: 'opponent',
    systemPrompt: `你是质疑智能体，负责挑毛病。
特点：谨慎、批判性思维、风险意识强。
职责：从多角度质疑方案，挑战假设，提出风险。`,
    model: {
      provider: 'anthropic',
      name: 'claude-3-opus',
      temperature: 0.5  // 中等，有逻辑但也敢挑战
    }
  },
  
  pragmatist: {
    role: 'pragmatist',
    systemPrompt: `你是务实派智能体。
特点：接地气、关注可行性、成本敏感。
职责：评估方案的实际可行性，指出执行难点。`,
    model: {
      provider: 'bailian',
      name: 'qwen-max',
      temperature: 0.4
    }
  },
  
  judge: {
    role: 'judge',
    systemPrompt: `你是裁判智能体。
特点：公正客观、综合能力强、决策果断。
职责：主持辩论，识别关键争议，给出最终裁决。`,
    model: {
      provider: 'openai',
      name: 'gpt-4',
      temperature: 0.3  // 低温度，更稳定
    }
  }
};
```

## 辩论流程

```
┌─────────────────────────────────────────────────────────────┐
│                      三方辩论模式                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌───────────┐   ┌───────────┐   ┌───────────┐           │
│   │ GPT-4     │   │ Claude    │   │ Qwen      │           │
│   │ (策划)    │   │ (质疑)    │   │ (务实)    │           │
│   │ 乐观创新  │   │ 谨慎批判  │   │ 可行性    │           │
│   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘           │
│         │               │               │                  │
│         └───────────────┼───────────────┘                  │
│                         │                                   │
│                         ▼                                   │
│                  ┌───────────┐                             │
│                  │ GPT-4     │                             │
│                  │ (裁判)    │                             │
│                  └───────────┘                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 实现代码

```typescript
import { spawnAgent, waitAgent, executeAgent } from './unified-agent-system';
import { DEBATE_ROLES } from './debate-config';

interface DebateResult {
  proposal: string;
  challenges: string[];
  defenses: string[];
  pragmatistViews: string[];
  verdict: string;
  confidence: 'high' | 'medium' | 'low';
}

export async function runMultiModelDebate(
  topic: string,
  options: {
    rounds?: number;
    includePragmatist?: boolean;
  } = {}
): Promise<DebateResult> {
  const { rounds = 2, includePragmatist = true } = options;
  const mainAgentId = getActiveAgent();
  
  // 1. 创建辩论参与者
  const proponentId = await spawnAgent(mainAgentId, {
    role: DEBATE_ROLES.proponent.role,
    model: DEBATE_ROLES.proponent.model,
    message: DEBATE_ROLES.proponent.systemPrompt
  });
  
  const opponentId = await spawnAgent(mainAgentId, {
    role: DEBATE_ROLES.opponent.role,
    model: DEBATE_ROLES.opponent.model,
    message: DEBATE_ROLES.opponent.systemPrompt
  });
  
  let pragmatistId: string | null = null;
  if (includePragmatist) {
    pragmatistId = await spawnAgent(mainAgentId, {
      role: DEBATE_ROLES.pragmatist.role,
      model: DEBATE_ROLES.pragmatist.model,
      message: DEBATE_ROLES.pragmatist.systemPrompt
    });
  }
  
  // 2. 初始提案
  let proposal = await executeAgent(proponentId, `
    请针对以下主题提出完整方案：
    
    ${topic}
    
    方案需包含：
    1. 核心观点
    2. 数据支撑
    3. 预期效果
    4. 潜在风险
  `);
  
  const challenges: string[] = [];
  const defenses: string[] = [];
  const pragmatistViews: string[] = [];
  
  // 3. 辩论循环
  for (let i = 0; i < rounds; i++) {
    // 质疑
    const challenge = await executeAgent(opponentId, `
      以下是方案内容，请从以下角度质疑：
      
      【当前方案】
      ${proposal}
      
      【质疑角度】
      1. 数据是否可靠？
      2. 逻辑是否严密？
      3. 是否存在盲点？
      4. 风险是否被低估？
      5. 是否有更好的替代方案？
    `);
    challenges.push(challenge);
    
    // 务实派评估
    if (pragmatistId) {
      const pragmatistView = await executeAgent(pragmatistId, `
        以下是方案和质疑，请从务实角度评估：
        
        【方案】
        ${proposal}
        
        【质疑】
        ${challenge}
        
        【评估角度】
        1. 执行难度
        2. 资源需求
        3. 时间成本
        4. ROI 预估
      `);
      pragmatistViews.push(pragmatistView);
    }
    
    // 辩护
    const defense = await executeAgent(proponentId, `
      请回应以下质疑：
      
      【质疑内容】
      ${challenge}
      
      ${pragmatistViews.length > 0 ? `【务实派观点】\n${pragmatistViews[pragmatistViews.length - 1]}` : ''}
      
      【回应要求】
      1. 直接回答质疑点
      2. 承认合理的批评
      3. 提出改进方案
    `);
    defenses.push(defense);
    
    // 更新方案
    proposal = defense;
  }
  
  // 4. 裁决
  const verdict = await executeAgent(mainAgentId, `
    作为裁判，请综合以下辩论给出最终裁决：
    
    【初始提案】
    ${proposal}
    
    【质疑历史】
    ${challenges.map((c, i) => `第${i + 1}轮质疑：${c}`).join('\n\n')}
    
    【辩护历史】
    ${defenses.map((d, i) => `第${i + 1}轮辩护：${d}`).join('\n\n')}
    
    【务实派观点】
    ${pragmatistViews.join('\n\n')}
    
    【裁决要求】
    1. 总结各方核心观点
    2. 识别关键争议点
    3. 给出最终决策
    4. 明确行动建议
    5. 评估置信度（高/中/低）
  `);
  
  // 5. 清理分身
  await terminateAgent(proponentId);
  await terminateAgent(opponentId);
  if (pragmatistId) await terminateAgent(pragmatistId);
  
  return {
    proposal,
    challenges,
    defenses,
    pragmatistViews,
    verdict,
    confidence: extractConfidence(verdict)
  };
}

function extractConfidence(verdict: string): 'high' | 'medium' | 'low' {
  if (verdict.includes('高')) return 'high';
  if (verdict.includes('中')) return 'medium';
  return 'low';
}
```

## 使用示例

```typescript
// 游戏市场定位辩论
const result = await runMultiModelDebate(
  `分析 Roguelike 卡牌游戏的市场定位：
  - 目标平台：Steam
  - 预算：50万
  - 团队：5人
  - 周期：6个月`,
  { rounds: 3, includePragmatist: true }
);

console.log('最终方案：', result.verdict);
console.log('置信度：', result.confidence);
```

## 成本对比

| 方案 | Token 消耗 | 效果 |
|------|-----------|------|
| 单模型单智能体 | 1x | 基础 |
| 单模型多分身 | 3x | 中等 |
| 多模型辩论 | 3x + 跨模型费用 | 最佳 |

## 注意事项

1. **API 成本**：多模型会增加 API 调用费用
2. **延迟**：并行执行可减少总时间
3. **配置**：确保各模型的 API Key 已配置
4. **温度**：根据角色调整温度参数