/**
 * 检查审核节点执行记录
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data/workflow-states/workflow.db');
const db = new Database(dbPath);

console.log('=== 最近的工作流实例 ===');
const instances = db.prepare(`
  SELECT instance_id, workflow_id, workflow_name, status, started_at, completed_at
  FROM workflow_instances
  ORDER BY started_at DESC
  LIMIT 5
`).all();

instances.forEach(inst => {
  console.log(`\n实例: ${inst.instance_id}`);
  console.log(`  工作流: ${inst.workflow_name || inst.workflow_id}`);
  console.log(`  状态: ${inst.status}`);
  console.log(`  开始: ${inst.started_at}`);
  console.log(`  完成: ${inst.completed_at || '未完成'}`);
  
  // 获取该实例的所有节点执行记录
  const nodes = db.prepare(`
    SELECT id, node_id, node_name, node_type, status, started_at, completed_at, retry_count
    FROM node_executions
    WHERE instance_id = ?
    ORDER BY started_at
  `).all(inst.instance_id);
  
  console.log(`  节点执行记录 (${nodes.length} 条):`);
  
  // 统计每个节点的执行次数
  const nodeCount = {};
  nodes.forEach(n => {
    const key = `${n.node_id}(${n.node_name})`;
    if (!nodeCount[key]) {
      nodeCount[key] = [];
    }
    nodeCount[key].push({
      id: n.id,
      type: n.node_type,
      status: n.status,
      started: n.started_at,
      completed: n.completed_at,
      retry: n.retry_count
    });
  });
  
  // 显示每个节点的执行次数
  Object.entries(nodeCount).forEach(([key, records]) => {
    const type = records[0].type;
    const count = records.length;
    console.log(`    - ${key} [${type}]: ${count} 次执行`);
    if (count > 1 || type === 'review') {
      records.forEach((r, i) => {
        console.log(`      第${i+1}次: status=${r.status}, retry=${r.retry || 0}`);
      });
    }
  });
});

// 特别检查审核节点
console.log('\n\n=== 审核节点详细分析 ===');
const reviewNodes = db.prepare(`
  SELECT ne.id, ne.instance_id, ne.node_id, ne.node_name, ne.status, 
         ne.started_at, ne.completed_at, ne.retry_count, ne.output,
         wi.workflow_name
  FROM node_executions ne
  JOIN workflow_instances wi ON ne.instance_id = wi.instance_id
  WHERE ne.node_type = 'review'
  ORDER BY ne.started_at DESC
  LIMIT 20
`).all();

if (reviewNodes.length === 0) {
  console.log('没有审核节点执行记录');
} else {
  console.log(`找到 ${reviewNodes.length} 条审核节点记录:`);
  reviewNodes.forEach(n => {
    console.log(`\n  记录ID: ${n.id}`);
    console.log(`  工作流: ${n.workflow_name}`);
    console.log(`  节点: ${n.node_name} (${n.node_id})`);
    console.log(`  状态: ${n.status}`);
    console.log(`  开始: ${n.started_at}`);
    console.log(`  完成: ${n.completed_at || '未完成'}`);
    console.log(`  重试次数: ${n.retry_count || 0}`);
    if (n.output) {
      try {
        const output = JSON.parse(n.output);
        console.log(`  输出: ${JSON.stringify(output).slice(0, 200)}...`);
      } catch (e) {
        console.log(`  输出: (解析失败)`);
      }
    }
  });
}

db.close();