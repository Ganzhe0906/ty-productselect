import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import axios from 'axios';
import { getLibraryById, initDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

  try {
    await initDb();
    const lib = await getLibraryById(id);
    if (!lib || !lib.excel_url) {
      return NextResponse.json({ error: 'Library or Excel not found' }, { status: 404 });
    }

    console.log(`[Parse] Downloading and parsing Excel from R2: ${lib.excel_url}`);
    
    // 1. 下载 R2 上的 Excel
    const response = await axios.get(lib.excel_url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    // 2. 使用 ExcelJS 解析图片
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) throw new Error('Worksheet not found');

    const images = worksheet.getImages();
    const rowImageMap: Record<number, string> = {};

    images.forEach((img) => {
      try {
        const imgData = workbook.getImage(img.imageId as any);
        if (!imgData.buffer) return;
        
        const row = Math.floor(img.range.tl.nativeRow);
        const base64 = `data:image/${imgData.extension};base64,${Buffer.from(imgData.buffer as any).toString('base64')}`;
        
        // 存入行号映射 (ExcelJS 的 row 是 0-based)
        if (!rowImageMap[row]) {
          rowImageMap[row] = base64;
        }
      } catch (e) {
        console.error('[Parse] Image extract error:', e);
      }
    });

    // 3. 将图片 Base64 注入到产品数据中
    const productsWithImages = (lib.products as any[]).map((p, i) => {
      // 这里的 i 对应 rows 里的索引，母版 Excel 的第 i+2 行对应产品的第 i 个
      // rowImageMap 的 key 是 0-based row index，所以第 2 行是 1
      const rowIndex = i + 1; 
      return {
        ...p,
        _image_url: rowImageMap[rowIndex] || null
      };
    });

    return NextResponse.json({
      ...lib,
      timestamp: Number(lib.timestamp),
      products: productsWithImages
    });
  } catch (error: any) {
    console.error('[Parse] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
