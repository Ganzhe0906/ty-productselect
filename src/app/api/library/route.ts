import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import crypto from 'crypto';
import { initDb, getLibraries, saveLibrary, deleteLibrary, getLibraryById, updateLibraryName, getLibrariesByMotherId } from '@/lib/db';
import { uploadToBlob, deleteFromBlob, isR2Url } from '@/lib/blob-utils';
import { FIELD_ALIASES } from '@/lib/excel';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = (searchParams.get('type') as 'pending' | 'completed') || 'pending';
  const id = searchParams.get('id');

  try {
    await initDb();

    // If ID is provided, return full detail for a single library
    if (id) {
      const lib = await getLibraryById(id);
      if (!lib) return NextResponse.json({ error: 'Library not found' }, { status: 404 });
      
      return NextResponse.json({
        id: lib.id,
        name: lib.name,
        timestamp: Number(lib.timestamp),
        products: lib.products,
        excelUrl: lib.excel_url,
        originalLibraryId: lib.original_library_id
      });
    }

    // Otherwise return list of libraries (optimized)
    const libraries = await getLibraries(type);
    
    // If fetching pending, also find who has completed them
    let completionMap: Record<string, string[]> = {};
    if (type === 'pending') {
      const allCompleted = await getLibraries('completed');
      allCompleted.forEach(comp => {
        const oid = comp.original_library_id || (comp as any).originallibraryid;
        const creator = comp.created_by || (comp as any).createdby;
        
        if (oid && creator) {
          const oidStr = String(oid).toLowerCase();
          const creatorStr = String(creator).toLowerCase();
          
          if (!completionMap[oidStr]) {
            completionMap[oidStr] = [];
          }
          if (!completionMap[oidStr].includes(creatorStr)) {
            completionMap[oidStr].push(creatorStr);
          }
        }
      });
    }

    // Map database rows to the format expected by the frontend
    // Optimization: In list view, we don't need the full products array which can be huge.
    // We only return the count to save bandwidth and prevent fetch errors.
    const items = libraries.map(lib => {
      const libId = String(lib.id).toLowerCase();
      return {
        id: lib.id,
        name: lib.name,
        timestamp: lib.timestamp ? Number(lib.timestamp) : Date.now(),
        // If we are just listing libraries, we don't need all products.
        // But we need to keep the structure compatible.
        // We return an empty array or a very small sample if it's a list request.
        products: Array.isArray(lib.products) ? (lib.products.length > 0 ? [lib.products[0]] : []) : [],
        productCount: Array.isArray(lib.products) ? lib.products.length : 0,
        excelUrl: lib.excel_url || '',
        originalLibraryId: lib.original_library_id || (lib as any).originallibraryid || null,
        completedBy: completionMap[libId] || []
      };
    });

    return NextResponse.json(items);
  } catch (error: any) {
    console.error('Fetch libraries error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const type = (formData.get('type') as 'pending' | 'completed') || 'pending';
    
    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });

    const id = crypto.randomUUID();
    const fileName = file.name;
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 1. 解析原始 Excel (提取图片)
    console.log(`[Library] Processing file: ${fileName}, size: ${buffer.length} bytes`);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch (err: any) {
      console.error('[Library] ExcelJS load error:', err);
      throw new Error(`无法解析 Excel 文件内容 (ExcelJS): ${err.message}`);
    }

    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) throw new Error('Excel 文件中未找到有效的工作表');

    const images = worksheet.getImages();
    console.log(`[Library] Found ${images.length} images in worksheet`);
    
    const rowImageMap: Record<number, { buffer: Buffer, ext: string }> = {};

    // 提取图片 Buffer (暂不上传 R2，等下直接嵌入新表)
    if (images.length > 0) {
      images.forEach((img) => {
        try {
          const imgData = workbook.getImage(img.imageId as any);
          if (!imgData.buffer) return;
          const row = Math.floor(img.range.tl.nativeRow);
          // 我们只存每一行的第一张图
          if (!rowImageMap[row]) {
            rowImageMap[row] = { 
              buffer: Buffer.from(imgData.buffer as any), 
              ext: imgData.extension || 'png' 
            };
          }
        } catch (imgErr) {
          console.error('[Library] Image extraction skip:', imgErr);
        }
      });
    }

    // 2. 解析表格数据 (仅提取识别出的字段)
    let rawData: any[][] = [];
    try {
      const workbookXLSX = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbookXLSX.SheetNames[0];
      const worksheetXLSX = workbookXLSX.Sheets[sheetName];
      rawData = XLSX.utils.sheet_to_json(worksheetXLSX, { header: 1, defval: "", raw: false }) as any[][];
    } catch (err: any) {
      console.error('[Library] XLSX read error:', err);
      throw new Error(`无法读取表格数据 (XLSX): ${err.message}`);
    }
    
    if (rawData.length === 0) throw new Error('Excel 文件内容为空');
    
    const originalHeaders = rawData[0] as string[];
    const rows = rawData.slice(1);
    
    // 识别目标字段
    const targetFields: { index: number, key: string }[] = [];
    originalHeaders.forEach((h, i) => {
      const cleanH = String(h || '').trim();
      for (const [standardKey, aliases] of Object.entries(FIELD_ALIASES)) {
        if (aliases.includes(cleanH) || cleanH === standardKey) {
          targetFields.push({ index: i, key: standardKey });
          break;
        }
      }
    });

    // 3. 构建“纯净版母库” Excel
    const cleanWorkbook = new ExcelJS.Workbook();
    const cleanSheet = cleanWorkbook.addWorksheet('待选品库');
    
    // 设置表头 (增加一列“主图”放在最前面)
    const finalHeaders = ['主图', ...targetFields.map(f => f.key)];
    cleanSheet.columns = finalHeaders.map(h => ({
      header: h,
      key: h,
      width: h === '主图' ? 20 : 25
    }));

    const products: any[] = [];

    // 填充数据并处理图片
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const excelRowIndex = i + 2; // Excel 中的行号 (1-based, header is 1)
      const dataRow: any = {};
      
      // 提取目标字段数据
      targetFields.forEach(f => {
        dataRow[f.key] = row[f.index];
      });

      const newRow = cleanSheet.addRow({
        ...dataRow,
        '主图': ' ' // 留空用于放图片
      });
      newRow.height = 100;

      // 处理图片：仅嵌入新 Excel，不再上传 R2 碎图片
      const imgInfo = rowImageMap[i + 1];
      if (imgInfo) {
        // 嵌入图片到新表
        const imageId = cleanWorkbook.addImage({
          buffer: imgInfo.buffer as any,
          extension: imgInfo.ext as any,
        });
        cleanSheet.addImage(imageId, {
          tl: { col: 0, row: i + 1 },
          ext: { width: 120, height: 120 },
          editAs: 'oneCell'
        });
      }

      products.push({
        ...dataRow,
        _index: excelRowIndex
      });
    }

    // 4. 上传纯净版母库 Excel 到 R2 (此时 R2 只有这一个文件)
    const cleanBuffer = await cleanWorkbook.xlsx.writeBuffer();
    const excelUrl = await uploadToBlob(`libraries/${id}.xlsx`, Buffer.from(cleanBuffer as ArrayBuffer), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    // 5. 保存元数据到 Postgres
    const libraryData = {
      id,
      name: fileName,
      type,
      timestamp: Date.now(),
      excel_url: excelUrl,
      products
    };
    await saveLibrary(libraryData);

    return NextResponse.json({
      id,
      name: fileName,
      timestamp: libraryData.timestamp,
      products,
      excelUrl
    });
  } catch (error: any) {
    console.error('Library upload error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) return NextResponse.json({ error: 'No ID' }, { status: 400 });

  try {
    await initDb();
    const lib = await getLibraryById(id);
    if (!lib) return NextResponse.json({ error: 'Library not found' }, { status: 404 });

    // 1. 如果删除的是母库 (pending)，先连带删除所有子库 (completed)
    if (lib.type === 'pending') {
      console.log(`[Cascade Delete] Detecting mother library deletion. Cleaning up children...`);
      const children = await getLibrariesByMotherId(id);
      console.log(`[Cascade Delete] Found ${children.length} child libraries to remove.`);
      
      for (const child of children) {
        // 删除子库的 Excel
        if (child.excel_url) {
          console.log(`[Cascade Delete] Removing child Excel: ${child.excel_url}`);
          await deleteFromBlob(child.excel_url);
        }
        // 删除子库数据库记录
        await deleteLibrary(child.id);
      }
    }

    // 2. Delete the Excel file associated with this record
    if (lib.excel_url) {
      console.log(`[Delete] Removing Excel file from R2: ${lib.excel_url}`);
      await deleteFromBlob(lib.excel_url);
    }
    
    // 2. ONLY delete images if we are deleting a 'pending' library (the source)
    if (lib.type === 'pending') {
      console.log(`[Delete] Library is 'pending', cleaning up all associated images on R2...`);
      const imageUrls = new Set<string>();
      if (Array.isArray(lib.products)) {
        lib.products.forEach((p: any) => {
          Object.values(p).forEach((val: any) => {
            if (typeof val === 'string' && isR2Url(val)) {
              imageUrls.add(val);
            }
          });
        });
      }
      
      if (imageUrls.size > 0) {
        console.log(`[Delete] Found ${imageUrls.size} unique R2 images to delete`);
        // Batch delete to avoid hitting rate limits or connection issues
        const urls = Array.from(imageUrls);
        for (let i = 0; i < urls.length; i += 20) {
          const batch = urls.slice(i, i + 20);
          await Promise.all(batch.map(url => deleteFromBlob(url)));
        }
      }
    } else {
      console.log(`[Delete] Library type is '${lib.type}', skipping image deletion to keep references intact.`);
    }

    // 3. Delete from Postgres
    await deleteLibrary(id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete library error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await initDb();
    const { id, name } = await req.json();
    
    if (!id || !name) {
      return NextResponse.json({ error: 'Missing id or name' }, { status: 400 });
    }

    await updateLibraryName(id, name);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Update library name error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
