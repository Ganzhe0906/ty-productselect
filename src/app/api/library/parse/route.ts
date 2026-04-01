import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import axios from 'axios';
import { getLibraryById, initDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
    const id = req.nextUrl.searchParams.get('id');

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
        
        // ExcelJS 的 row 索引: nativeRow 通常是从 0 开始（0代表第一行）
        // 如果 nativeRow === 0 是表头，那么 nativeRow === 1 是第一条商品数据
        if (!rowImageMap[row]) {
          rowImageMap[row] = base64;
        }
      } catch (e) {
        console.error('[Parse] Image extract error:', e);
      }
    });

    console.log('[Parse] rowImageMap keys (nativeRows with images):', Object.keys(rowImageMap));

    // 3. 将图片 Base64 注入到产品数据中
    const productsWithImages = (lib.products as any[]).map((p, i) => {
      // 这里的 i = 0 对应第一条商品
      // 如果 Excel 表头在 nativeRow 0，第一条商品在 nativeRow 1
      const rowIndex = i + 1; 
      
      const img = rowImageMap[rowIndex] || null;
      console.log(`[Parse] item i=${i} => rowIndex=${rowIndex} => img? ${!!img}`);
      
      return {
        ...p,
        _image_url: img
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
