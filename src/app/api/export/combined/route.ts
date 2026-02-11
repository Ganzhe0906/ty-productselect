import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getLibraries, initDb } from '@/lib/db';
import axios from 'axios';

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const { originalLibraryId } = await req.json();
    
    if (!originalLibraryId) {
      return NextResponse.json({ error: 'Original Library ID is required' }, { status: 400 });
    }

    // 1. 获取该母库对应的所有完成记录
    const allCompleted = await getLibraries('completed');
    
    let flzLib = null;
    let lyyLib = null;

    // 仅通过 ID 匹配 (不分大小写)
    const pendingIdStr = String(originalLibraryId).toLowerCase();
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
      throw new Error(`未找到双人的完整选品记录 (母库 ID: ${originalLibraryId})`);
    }

    // 2. 取交集逻辑：比对 _index
    const flzIndexes = new Set(flzLib.products.map((p: any) => p._index));
    const combinedProducts = lyyLib.products.filter((p: any) => flzIndexes.has(p._index));

    if (combinedProducts.length === 0) {
      throw new Error('双人选品没有重合项');
    }

    // 3. 生成 Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('双人共同选中');
    
    // 获取表头（从第一个商品对象的 key 中提取，排除隐藏字段）
    const allKeys = new Set<string>();
    combinedProducts.forEach((p: any) => {
      Object.keys(p).forEach(k => {
        if (!k.startsWith('_')) allKeys.add(k);
      });
    });
    
    const keys = Array.from(allKeys);
    worksheet.columns = keys.map(key => ({
      header: key,
      key: key,
      width: (key === '中文商品名' || key === '场景用途') ? 30 : 25
    }));

    // 添加数据行
    for (let i = 0; i < combinedProducts.length; i++) {
      const p = combinedProducts[i];
      const row = worksheet.addRow(p);
      row.height = 100;
      
      // 处理图片
      const imageUrl = p['主图src'] || p.src || '';
      if (imageUrl && imageUrl.startsWith('http')) {
        try {
          const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
          const imageBuffer = Buffer.from(response.data);
          const extension = imageUrl.toLowerCase().includes('.png') ? 'png' : 'jpeg';
          
          const imageId = workbook.addImage({
            buffer: imageBuffer,
            extension: extension as 'png' | 'jpeg',
          });

          worksheet.addImage(imageId, {
            tl: { col: 0, row: i + 1 },
            ext: { width: 120, height: 120 },
            editAs: 'oneCell'
          });
          
          // 清除单元格文字，只留图片
          row.getCell(1).value = ' ';
        } catch (e) {
          console.error('图片下载失败:', imageUrl);
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="combined_selection.xlsx"`
      }
    });

  } catch (error: any) {
    console.error('Combined export error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
