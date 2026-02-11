import { NextRequest, NextResponse } from 'next/server';
import { getLibraries, initDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await initDb();
    
    // 1. 抓取所有记录进行诊断
    const allPending = await getLibraries('pending');
    const allCompleted = await getLibraries('completed');
    
    console.log(`[Combined API] 诊断开始: 发现 ${allPending.length} 个母库, ${allCompleted.length} 个完成记录`);

    // 2. 重写判定逻辑：分步校验
    const combinedList = allPending.map(pending => {
      const pendingId = String(pending.id).toLowerCase();
      
      // 第一步校验：查找所有关联到该母库 ID 的完成记录
      const relatedCompleted = allCompleted.filter(comp => {
        // 兼容不同驱动返回的字段名，并进行严格的格式化
        const oid = comp.original_library_id || (comp as any).originallibraryid;
        if (!oid) return false;
        
        const oidStr = String(oid).toLowerCase().trim();
        return oidStr === pendingId;
      });

      if (relatedCompleted.length > 0) {
        console.log(`[Combined API] 母库 "${pending.name}" 匹配到 ${relatedCompleted.length} 条子记录:`, 
          relatedCompleted.map(c => ({ user: c.created_by || (c as any).createdby, id: c.id }))
        );
      }

      // 第二步校验：在匹配到的记录中，识别选品人并提取数据
      const getLatestForUser = (username: string) => {
        const userRecords = relatedCompleted.filter(c => {
          const creator = String(c.created_by || (c as any).createdby || '').toLowerCase().trim();
          return creator === username;
        });
        
        if (userRecords.length === 0) return null;
        
        // 按时间戳排序，确保拿到最新的
        const latest = userRecords.sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0];
        
        return {
          id: latest.id,
          count: Array.isArray(latest.products) ? latest.products.length : 0,
          products: latest.products,
          timestamp: Number(latest.timestamp)
        };
      };

      const flz = getLatestForUser('flz');
      const lyy = getLatestForUser('lyy');

      // 第三步：计算交集
      let combinedCount = 0;
      if (flz && lyy) {
        const flzIndexes = new Set(flz.products.map((p: any) => p._index));
        const intersection = lyy.products.filter((p: any) => flzIndexes.has(p._index));
        combinedCount = intersection.length;
      }

      return {
        id: pending.id,
        name: pending.name,
        productCount: Array.isArray(pending.products) ? pending.products.length : 0,
        timestamp: Number(pending.timestamp), // 强制转数字，修复 Invalid Date
        flz: flz ? { count: flz.count } : null,
        lyy: lyy ? { count: lyy.count } : null,
        combinedCount,
        isBothDone: !!(flz && lyy)
      };
    });

    // 按时间倒序排列
    combinedList.sort((a, b) => b.timestamp - a.timestamp);

    return NextResponse.json(combinedList);
  } catch (error: any) {
    console.error('[Combined API] 关键错误:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
