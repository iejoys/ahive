# 游戏开发全流程

端到端自动化游戏开发：从市场调研到 Steam 上架。

## 工作流阶段

```
阶段1: 市场调研     → 输出: market-analysis.md
阶段2: 游戏设计     → 输出: game-design.md  
阶段3: 技术选型     → 输出: tech-stack.md
阶段4: 原型开发     → 输出: prototype/
阶段5: 内容生产     → 输出: assets/, audio/
阶段6: 正式开发     → 输出: src/
阶段7: 测试QA       → 输出: test-report.md
阶段8: 审核评分     → 输出: rating-report.md
阶段9: Steam上架    → 输出: store-page/
```

## 使用方法

```bash
# 启动完整流程
spawn_agent({ type: "codex", skill: "game-dev-pipeline", task: "开发一款Roguelike卡牌游戏" })

# 启动单个阶段
spawn_agent({ type: "codex", skill: "game-dev-pipeline/stages/1-market-research", task: "调研Roguelike市场" })
```

## 阶段详情

### 阶段1: 市场调研 (2-3天)
**目标**: 分析市场趋势，确定游戏方向

**执行步骤**:
1. Steam 热销榜数据抓取
2. 竞品分析（同品类TOP10）
3. 用户评论情感分析
4. 市场空白点识别
5. 输出 `market-analysis.md`

**关键产出**:
- 目标用户画像
- 竞品优劣势分析
- 差异化定位建议
- 定价策略建议

### 阶段2: 游戏设计 (1-2天)
**目标**: 完成游戏策划案

**执行步骤**:
1. 核心玩法设计
2. 系统设计（战斗、成长、经济）
3. 关卡设计
4. 数值框架
5. 输出 `game-design.md`

**关键产出**:
- GDD文档
- UI流程图
- 数值表
- 剧情大纲

### 阶段3: 技术选型 (1天)
**目标**: 确定技术方案

**执行步骤**:
1. 引擎选择（Unity/Unreal/Godot/自研）
2. 技术栈确定
3. 架构设计
4. 第三方服务选型
5. 输出 `tech-stack.md`

### 阶段4: 原型开发 (3-5天)
**目标**: 验证核心玩法

**执行步骤**:
1. 搭建项目框架
2. 实现核心机制
3. 灰盒原型
4. 快速迭代验证
5. 输出 `prototype/`

### 阶段5: 内容生产 (持续)
**目标**: 美术、音效、文案

**子任务分配**:
```
spawn_agent({ task: "美术生产", type: "codex", skill: "art-pipeline" })
spawn_agent({ task: "音效配乐", type: "codex", skill: "audio-pipeline" })
spawn_agent({ task: "文案撰写", type: "codex", skill: "writing-pipeline" })
```

### 阶段6: 正式开发 (持续)
**目标**: 完整游戏开发

**执行方式**:
- 主 Codex 负责架构和核心系统
- spawn 分身处理模块化任务
- 每日构建 + 自动测试

### 阶段7: 测试QA (3-5天)
**目标**: 保证质量

**执行步骤**:
1. 自动化测试用例生成
2. 功能测试
3. 性能测试
4. 兼容性测试
5. 输出 `test-report.md`

### 阶段8: 审核评分 (1-2天)
**目标**: 预估评级，规避风险

**执行步骤**:
1. 内容审核（暴力、敏感）
2. 各国分级预估
3. 合规检查
4. 输出 `rating-report.md`

### 阶段9: Steam上架 (2-3天)
**目标**: 完成商店页面

**执行步骤**:
1. 商店页面文案
2. 截图/预告片
3. 成就设计
4. Steamworks 配置
5. 输出 `store-page/`

## 协作机制

### 主智能体职责
- 把控整体进度
- 分配子任务
- 整合产出
- 质量把控

### 分身智能体职责
- 执行具体任务
- 独立完成模块
- 返回产出结果

### 记忆共享
```
data/memories/projects/{game-name}/
├── MEMORY.md           # 项目知识汇总
├── market-analysis.md
├── game-design.md
├── tech-stack.md
└── rollout_summaries/  # 各阶段记录
```

## 检查点机制

每个阶段完成后自动生成检查点：

```json
{
  "stage": "market-research",
  "status": "completed",
  "outputs": ["market-analysis.md"],
  "metrics": {
    "duration": "2.5 days",
    "token_usage": 150000
  },
  "next_stage": "game-design"
}
```

## 回滚机制

如某阶段失败：
```
回滚到上一检查点 → 重新执行该阶段
```

## 外部服务集成

| 服务 | 用途 | 调用时机 |
|------|------|----------|
| Steam API | 数据抓取 | 阶段1 |
| Midjourney API | 概念图 | 阶段2 |
| Suno API | 背景音乐 | 阶段5 |
| Steamworks | 上架配置 | 阶段9 |