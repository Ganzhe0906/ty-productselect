import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getLibraries, initDb, getLibraryById } from '@/lib/db';
import axios from 'axios';

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const { originalLibraryId } = await req.json();
    
    if (!originalLibraryId) {
      return NextResponse.json({ error: 'Original Library ID is required' }, { status: 400 });
    }

    // 1. 获取母库以提取原始表头顺序
    const motherLib = await getLibraryById(originalLibraryId);
    if (!motherLib) {
      throw new Error('未找到母库信息，无法确定表头顺序');
    }

    // 从母库第一个商品中提取原始表头顺序
    const originalHeaders: string[] = [];
    if (motherLib.products && motherLib.products.length > 0) {
      Object.keys(motherLib.products[0]).forEach(key => {
        if (!key.startsWith('_')) originalHeaders.push(key);
      });
    }

    // 2. 获取该母库对应的所有完成记录
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

    // 3. 取交集逻辑：比对 _index，并从母库中提取完整数据
    const flzIndexes = new Set(flzLib.products.map((p: any) => p._index));
    const commonIndexes = new Set(lyyLib.products.filter((p: any) => flzIndexes.has(p._index)).map((p: any) => p._index));

    if (commonIndexes.size === 0) {
      throw new Error('双人选品没有重合项');
    }

    // 从母库中提取完整的商品数据，确保包含所有 AI 翻译字段
    const combinedProducts = motherLib.products.filter((p: any) => commonIndexes.has(p._index));

    // 4. 下载并解析母库原始 Excel 文件以保持完美排版
    const fileResponse = await axios.get(motherLib.excel_url, { responseType: 'arraybuffer' });
    const motherBuffer = Buffer.from(fileResponse.data);
    
    const sourceWorkbook = new ExcelJS.Workbook();
    await sourceWorkbook.xlsx.load(motherBuffer);
    const sourceSheet = sourceWorkbook.getWorksheet(1);
    if (!sourceSheet) throw new Error('母库文件解析失败');

    // 5. 创建新的工作簿并复制样式和数据
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('双人共同选中');

    // 复制表头和列宽
    const headerRow = sourceSheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      worksheet.getColumn(colNumber).width = sourceSheet.getColumn(colNumber).width || 20;
      const targetCell = worksheet.getRow(1).getCell(colNumber);
      targetCell.value = cell.value;
      targetCell.style = cell.style;
    });

    // 寻找数据行并填充
    let currentRowIndex = 2;
    sourceSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // 跳过表头

      if (commonIndexes.has(rowNumber)) {
        const newRow = worksheet.getRow(currentRowIndex);
        newRow.height = row.height || 100;
        
        // 复制这一行的所有单元格数据和样式
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const newCell = newRow.getCell(colNumber);
          newCell.value = cell.value;
          newCell.style = cell.style;
        });
        
        currentRowIndex++;
      }
    });

    // 6. 安全地克隆图片
    const sourceImages = sourceSheet.getImages();
    // 构建行号映射关系
    const rowMapping: Record<number, number> = {};
    let mappingIndex = 2;
    sourceSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (commonIndexes.has(rowNumber)) {
        rowMapping[rowNumber] = mappingIndex++;
      }
    });

    sourceImages.forEach(img => {
      const sourceRow = Math.floor(img.range.tl.nativeRow) + 1;
      if (commonIndexes.has(sourceRow)) {
        const targetRow = rowMapping[sourceRow];
        const imgData = sourceWorkbook.getImage(img.imageId as any);
        
        const newImageId = workbook.addImage({
          buffer: Buffer.from(imgData.buffer as any),
          extension: imgData.extension,
        });

        // 核心修复：增加安全检查，防止 br 为 undefined 导致的崩溃
        const tl = img.range.tl;
        const br = img.range.br;

        if (br) {
          // 如果有结束坐标，按原样比例克隆
          worksheet.addImage(newImageId, {
            tl: { col: tl.nativeCol, row: targetRow - 1 + (tl.nativeRow % 1) } as any,
            br: { col: br.nativeCol, row: targetRow - 1 + (br.nativeRow % 1) } as any,
            editAs: 'oneCell'
          });
        } else {
          // 如果没有结束坐标（单单元格锚定），手动指定大小
          worksheet.addImage(newImageId, {
            tl: { col: tl.nativeCol, row: targetRow - 1 + (tl.nativeRow % 1) } as any,
            ext: { width: 120, height: 120 },
            editAs: 'oneCell'
          });
        }
      }
    });

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
