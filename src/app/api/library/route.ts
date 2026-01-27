import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import crypto from 'crypto';
import { initDb, getLibraries, saveLibrary, deleteLibrary, getLibraryById } from '@/lib/db';
import { uploadToBlob, deleteFromBlob } from '@/lib/blob-utils';

const FIELD_MAP: Record<string, string[]> = {
  '商品标题': ['商品标题', '商品名'],
  '商品售价': ['商品售价', '最低售价'],
  '邮费': ['邮费', '物流费用'],
  '评分': ['评分', '商品评分'],
  '商店名称': ['商店名称', '店铺名'],
  '店铺销量': ['店铺销量', '店铺总销量'],
  '近7天销量': ['近7天销量', '近 7 天销量'],
  '近7天销售额': ['近7天销售额', '近 7 天销售额'],
  '中文商品名': ['中文商品名', '中文标题', 'chinese_name'],
  '场景用途': ['场景用途', '使用场景', 'usage_scenario'],
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = (searchParams.get('type') as 'pending' | 'completed') || 'pending';

  try {
    await initDb();
    const libraries = await getLibraries(type);
    
    // Map database rows to the format expected by the frontend
    const items = libraries.map(lib => ({
      id: lib.id,
      name: lib.name,
      timestamp: Number(lib.timestamp),
      products: lib.products,
      excelUrl: lib.excel_url,
      originalLibraryId: lib.original_library_id
    }));

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

    // 1. Upload the original Excel file to Vercel Blob
    const excelUrl = await uploadToBlob(`libraries/${id}.xlsx`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    // 2. Process images and extract data
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) throw new Error('No worksheet found');

    const images = worksheet.getImages();
    const imageMap: Record<string, string> = {};
    const rowImageMap: Record<number, string[]> = {};

    // Parallel upload images to Blob
    const imageUploadPromises = images.map(async (img) => {
      const imgData = workbook.getImage(img.imageId);
      if (!imgData.buffer) return;

      const row = Math.floor(img.range.tl.nativeRow);
      const col = Math.floor(img.range.tl.nativeCol);
      const ext = imgData.extension || 'png';
      const imgPath = `images/${id}/${row}_${col}_${img.imageId}.${ext}`;
      
      const blobUrl = await uploadToBlob(imgPath, Buffer.from(imgData.buffer as any), `image/${ext}`);
      
      imageMap[`${row}_${col}`] = blobUrl;
      if (!rowImageMap[row]) rowImageMap[row] = [];
      rowImageMap[row].push(blobUrl);
    });

    await Promise.all(imageUploadPromises);

    // 3. Parse data using XLSX
    const workbookXLSX = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbookXLSX.SheetNames[0];
    const worksheetXLSX = workbookXLSX.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(worksheetXLSX, { header: 1, defval: "" }) as any[][];
    
    if (rawData.length === 0) throw new Error('Excel is empty');
    
    const headers = rawData[0] as string[];
    const rows = rawData.slice(1);
    
    const knownImageHeaders = ['主图src', 'src'];
    const imageColIndices: number[] = [];
    headers.forEach((h, i) => {
      const cleanH = String(h || '').trim();
      if (knownImageHeaders.includes(cleanH) || cleanH.toLowerCase().includes('src')) {
        imageColIndices.push(i);
      }
    });
    if (imageColIndices.length === 0 && headers.length > 0) imageColIndices.push(0);

    const products = rows.map((row, rowIndex) => {
      const product: any = { _index: rowIndex + 2 };
      const actualRowInExcel = rowIndex + 1;

      headers.forEach((header, colIndex) => {
        const value = row[colIndex];
        const cleanHeader = String(header || '').trim();
        
        if (typeof value === 'string' && (value.startsWith('http') || value.includes('<img'))) {
          product[cleanHeader] = ' ';
        } else {
          product[cleanHeader] = value;
        }
        
        for (const [standardKey, aliases] of Object.entries(FIELD_MAP)) {
          if (aliases.includes(cleanHeader)) {
            product[standardKey] = product[cleanHeader];
          }
        }

        let localPath = imageMap[`${actualRowInExcel}_${colIndex}`];
        if (!localPath && imageColIndices.includes(colIndex)) {
          if (rowImageMap[actualRowInExcel] && rowImageMap[actualRowInExcel].length > 0) {
            localPath = rowImageMap[actualRowInExcel][0];
          }
        }

        if (localPath) {
          product[cleanHeader] = localPath;
          if (cleanHeader === '主图src' || cleanHeader === 'src' || (colIndex === imageColIndices[0])) {
            product['主图src'] = localPath;
          }
        }
      });
      
      if (!product['主图src'] && rowImageMap[actualRowInExcel] && rowImageMap[actualRowInExcel].length > 0) {
        product['主图src'] = rowImageMap[actualRowInExcel][0];
      }
      
      if (!product['类目'] && (product['商品一级分类'] || product['商品二级分类'])) {
        product['类目'] = [product['商品一级分类'], product['商品二级分类'], product['商品三级分类']].filter(Boolean).join(' > ');
      }
      
      return product;
    });

    // 4. Save metadata to Postgres
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

    // 1. Delete from Blob
    await deleteFromBlob(lib.excel_url);
    
    // Delete images (we don't have a list of all image URLs easily, 
    // but we can extract them from the products JSON)
    const imageUrls = new Set<string>();
    lib.products.forEach((p: any) => {
      Object.values(p).forEach((val: any) => {
        if (typeof val === 'string' && val.includes('public.blob.vercel-storage.com')) {
          imageUrls.add(val);
        }
      });
    });
    
    await Promise.all(Array.from(imageUrls).map(url => deleteFromBlob(url)));

    // 2. Delete from Postgres
    await deleteLibrary(id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete library error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
