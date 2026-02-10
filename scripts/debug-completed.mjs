
import { sql } from '@vercel/postgres';

async function debugCompletedLibrary() {
  try {
    console.log('正在查询 type="completed" 的数据...');
    const { rows } = await sql`SELECT * FROM libraries WHERE type = 'completed'`;
    console.log(`查询到 ${rows.length} 条记录`);
    
    if (rows.length > 0) {
      console.log('第一条记录详情:', JSON.stringify(rows[0], null, 2));
    }
  } catch (error) {
    console.error('❌ 查询失败:', error.message);
  }
}

debugCompletedLibrary();
