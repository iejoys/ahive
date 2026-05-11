/**
 * 记忆系统测试脚本
 */

import { MemoryManager, approxTokenCount, truncateWithTokenBudget } from './index.js';

console.log('=== AHIVECORE 记忆系统测试 ===\n');

// 1. 测试工具函数
console.log('1. 测试工具函数');
const tokens = approxTokenCount('Hello, this is a test message for token counting.');
console.log(`   Token 计算: ${tokens} tokens`);

const longText = 'This is a very long message that needs to be truncated to fit within the specified token budget for the memory system.';
const truncated = truncateWithTokenBudget(longText, 20);
console.log(`   截断测试: ${truncated}\n`);

// 2. 测试 MemoryManager
console.log('2. 测试 MemoryManager');
const manager = new MemoryManager({ 
    memoryRoot: './data/memories-test',
    isolationStrategy: 'type'
});
console.log('   ✅ MemoryManager 创建成功');

// 3. 测试数据库
console.log('\n3. 测试数据库');
const stats = manager.getAllStats();
console.log('   ✅ 数据库统计:', JSON.stringify(stats, null, 2));

// 4. 测试消息记录
console.log('\n4. 测试消息记录');
await manager.recordMessage('test-agent-001', 'ahive-worker', 'user', '你好，这是测试消息');
await manager.recordMessage('test-agent-001', 'ahive-worker', 'assistant', '收到！我明白了，这是一条测试消息。');
console.log('   ✅ 消息记录成功');

// 5. 测试记忆获取
console.log('\n5. 测试记忆获取');
const context = await manager.getMemoryContext('test-agent-001', 'ahive-worker', 1000);
console.log('   ✅ 记忆上下文:', context ? `${context.length} 字符` : '(空)');

// 6. 测试统计
console.log('\n6. 测试统计');
const newStats = manager.getAllStats();
console.log('   ✅ 更新后统计:', JSON.stringify(newStats, null, 2));

// 关闭
manager.close();
console.log('\n✅ MemoryManager 关闭成功');
console.log('\n🎉 记忆系统测试完成！');