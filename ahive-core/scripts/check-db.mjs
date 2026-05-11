import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'memories', 'memory.db');

console.log('数据库路径:', dbPath);
console.log('');

const db = new Database(dbPath);

console.log('=== 数据库表结构 ===\n');

// 获取所有表
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('表列表:', tables.map(t => t.name).join(', '));

// 查看每个表的结构和数据
for (const table of tables) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`=== 表: ${table.name} ===`);
    console.log('='.repeat(60));
    
    // 表结构
    const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE name=?`).get(table.name);
    console.log('\n表结构:\n', schema.sql);
    
    // 数据量
    const count = db.prepare(`SELECT COUNT(*) as count FROM "${table.name}"`).get();
    console.log('\n记录数:', count.count);
    
    // 前10条数据
    const rows = db.prepare(`SELECT * FROM "${table.name}" LIMIT 10`).all();
    console.log('\n示例数据 (前10条):');
    for (const row of rows) {
        console.log(JSON.stringify(row, null, 2));
    }
}

db.close();