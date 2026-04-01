import { NextRequest, NextResponse } from 'next/server';
import { getLibraries, initDb, getLibraryById } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await initDb();
    const id = req.nextUrl.searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'Original Library ID is required' }, { status: 400 });
    }

    // 1. 获取母库以提取原始数据
    const motherLib = await getLibraryById(id);
    if (!motherLib) {
      throw new Error('未找到母库信息');
    }

    // 2. 获取该母库对应的所有完成记录
    const allCompleted = await getLibraries('completed');
    
    let flzLib = null;
    let lyyLib = null;

    // 仅通过 ID 匹配 (不分大小写)
    const pendingIdStr = String(id).toLowerCase();
    const myCompleted = allCompleted.filter(lib => {
      const oid = lib.original_library_id || (lib as any).originallibraryid;
      return oid && String(oid).toLowerCase() === pendingIdStr;
    });
    
    const getLatestRecord = (user: string) => {
      return myCompleted
        .filter(l => {
          const creator = (l.created_by || (l as any).createdby || '').toLowerCase();
          return creator === user.toLowerCase();
        })
        .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0];
    };

    flzLib = getLatestRecord('flz');
    lyyLib = getLatestRecord('lyy');
    
    if (!flzLib || !lyyLib) {
      throw new Error(`未找到双人的完整选品记录 (母库 ID: ${id})`);
    }

    // 3. 取交集逻辑：比对 _index，但因为数据可能不稳定，增加按商品名后备匹配
    const flzSet = new Set(flzLib.products.map((p: any) => String(p._index || p['中文商品名'] || p['商品标题'] || p['title'] || p['商品名'] || '').trim()).filter(Boolean));
    const lyySet = new Set(lyyLib.products.map((p: any) => String(p._index || p['中文商品名'] || p['商品标题'] || p['title'] || p['商品名'] || '').trim()).filter(Boolean));

    // 取两人的交集 Set
    const commonSet = new Set([...lyySet].filter(x => flzSet.has(x)));

    if (commonSet.size === 0) {
      return NextResponse.json({ products: [] });
    }

    // 从母库中提取完整的商品数据，确保包含所有 AI 翻译字段和图片
    const combinedProducts = motherLib.products.filter((p: any) => {
      const pKey = String(p._index || p['中文商品名'] || p['商品标题'] || p['title'] || p['商品名'] || '').trim();
      return commonSet.has(pKey);
    });

    return NextResponse.json({ products: combinedProducts });

  } catch (error: any) {
    console.error('[Combined Detail API] 关键错误:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
