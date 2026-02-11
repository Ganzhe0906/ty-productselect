import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import crypto from 'crypto';
import { initDb, getLibraries, saveLibrary, deleteLibrary, getLibraryById, updateLibraryName } from '@/lib/db';
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

    // 1. Upload the original Excel file to Cloudflare R2
    const excelUrl = await uploadToBlob(`libraries/${id}.xlsx`, buffer as any, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    // 2. Process images and extract data
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
    
    const imageMap: Record<string, string> = {};
    const rowImageMap: Record<number, string[]> = {};

    // Parallel upload images to R2
    if (images.length > 0) {
      console.log(`[Library] Uploading ${images.length} images to R2...`);
      const imageUploadPromises = images.map(async (img) => {
        try {
          const imgData = workbook.getImage(img.imageId as any);
          if (!imgData.buffer) return;

          const row = Math.floor(img.range.tl.nativeRow);
          const col = Math.floor(img.range.tl.nativeCol);
          const ext = imgData.extension || 'png';
          const imgPath = `images/${id}/${row}_${col}_${img.imageId}.${ext}`;
          
          const blobUrl = await uploadToBlob(imgPath, Buffer.from(imgData.buffer as any), `image/${ext}`);
          
          imageMap[`${row}_${col}`] = blobUrl;
          if (!rowImageMap[row]) rowImageMap[row] = [];
          rowImageMap[row].push(blobUrl);
        } catch (imgErr) {
          console.error('[Library] Image upload skip:', imgErr);
        }
      });

      await Promise.all(imageUploadPromises);
    }

    // 3. Parse data using XLSX
    let rawData: any[][] = [];
    try {
      const workbookXLSX = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = workbookXLSX.SheetNames[0];
      const worksheetXLSX = workbookXLSX.Sheets[sheetName];
      // 修复：指定 raw: false 以确保获取格式化后的值（如价格数字）
      rawData = XLSX.utils.sheet_to_json(worksheetXLSX, { header: 1, defval: "", raw: false }) as any[][];
    } catch (err: any) {
      console.error('[Library] XLSX read error:', err);
      throw new Error(`无法读取表格数据 (XLSX): ${err.message}`);
    }
    
    if (rawData.length === 0) throw new Error('Excel 文件内容为空');
    
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
        
        for (const [standardKey, aliases] of Object.entries(FIELD_ALIASES)) {
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

    // 1. Delete the Excel file associated with this record
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
