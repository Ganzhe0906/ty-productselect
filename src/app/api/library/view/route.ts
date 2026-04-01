import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import axios from 'axios';
import { getLibraries, getLibraryById, initDb } from '@/lib/db';

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  return Buffer.from(res.data);
}

function buildImageMap(sourceSheet: ExcelJS.Worksheet): Map<string, string> {
  const map = new Map<string, string>();
  const images = sourceSheet.getImages();

  images.forEach((img) => {
    try {
      const row = Math.round(img.range.tl.nativeRow) + 1; // Excel row number
      const imgData = sourceSheet.workbook.getImage(img.imageId as any);
      if (!imgData?.buffer) return;
      const ext = imgData.extension || 'png';
      const base64 = Buffer.from(imgData.buffer as any).toString('base64');
      map.set(String(row), `data:image/${ext};base64,${base64}`);
    } catch {
      // ignore single-image parse errors to keep endpoint resilient
    }
  });

  return map;
}

function attachImagesByIndex(products: any[], imageMap: Map<string, string>): any[] {
  return products.map((p: any) => {
    const idx = p?._index;
    if (idx === undefined || idx === null || String(idx).trim() === '') return p;
    const img = imageMap.get(String(idx).trim());
    return img ? { ...p, _image_url: img } : p;
  });
}

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const body = await req.json();
    const mode = body?.mode as 'completed' | 'combined';

    if (mode === 'completed') {
      const libraryId = String(body?.libraryId || '').trim();
      if (!libraryId) {
        return NextResponse.json({ error: 'libraryId is required' }, { status: 400 });
      }

      const lib = await getLibraryById(libraryId);
      if (!lib) {
        return NextResponse.json({ error: 'Library not found' }, { status: 404 });
      }

      let sourceExcelUrl = lib.excel_url;
      if (lib.original_library_id) {
        const originalLib = await getLibraryById(lib.original_library_id);
        if (originalLib?.excel_url) sourceExcelUrl = originalLib.excel_url;
      }
      if (!sourceExcelUrl) {
        return NextResponse.json({ error: 'Source excel not found' }, { status: 404 });
      }

      const sourceBuffer = await downloadBuffer(sourceExcelUrl);
      const sourceWorkbook = new ExcelJS.Workbook();
      await sourceWorkbook.xlsx.load(sourceBuffer);
      const sourceSheet = sourceWorkbook.getWorksheet(1);
      if (!sourceSheet) {
        return NextResponse.json({ error: 'Worksheet not found' }, { status: 500 });
      }

      const imageMap = buildImageMap(sourceSheet);
      const products = attachImagesByIndex(lib.products || [], imageMap);
      return NextResponse.json({ products });
    }

    if (mode === 'combined') {
      const originalLibraryId = String(body?.originalLibraryId || '').trim();
      if (!originalLibraryId) {
        return NextResponse.json({ error: 'originalLibraryId is required' }, { status: 400 });
      }

      const motherLib = await getLibraryById(originalLibraryId);
      if (!motherLib?.excel_url) {
        return NextResponse.json({ error: 'Mother library not found' }, { status: 404 });
      }

      const allCompleted = await getLibraries('completed');
      const myCompleted = allCompleted.filter((lib: any) => {
        const oid = lib.original_library_id || lib.originallibraryid;
        return oid && String(oid).toLowerCase() === originalLibraryId.toLowerCase();
      });

      const getLatestRecord = (user: string) =>
        myCompleted
          .filter((l: any) => String(l.created_by || l.createdby || '').toLowerCase() === user.toLowerCase())
          .sort((a: any, b: any) => Number(b.timestamp) - Number(a.timestamp))[0];

      const flzLib = getLatestRecord('flz');
      const lyyLib = getLatestRecord('lyy');
      if (!flzLib || !lyyLib) {
        return NextResponse.json({ error: '未找到双人的完整选品记录' }, { status: 404 });
      }

      const flzIndexes = new Set((flzLib.products || []).map((p: any) => p._index));
      const commonIndexes = new Set(
        (lyyLib.products || []).filter((p: any) => flzIndexes.has(p._index)).map((p: any) => p._index)
      );

      const combinedProducts = (motherLib.products || []).filter((p: any) => commonIndexes.has(p._index));

      const sourceBuffer = await downloadBuffer(motherLib.excel_url);
      const sourceWorkbook = new ExcelJS.Workbook();
      await sourceWorkbook.xlsx.load(sourceBuffer);
      const sourceSheet = sourceWorkbook.getWorksheet(1);
      if (!sourceSheet) {
        return NextResponse.json({ error: 'Worksheet not found' }, { status: 500 });
      }

      const imageMap = buildImageMap(sourceSheet);
      const products = attachImagesByIndex(combinedProducts, imageMap);
      return NextResponse.json({ products });
    }

    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  } catch (error: any) {
    console.error('[Library View API] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}

