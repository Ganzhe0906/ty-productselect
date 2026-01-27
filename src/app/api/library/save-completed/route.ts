import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import crypto from 'crypto';
import { initDb, saveLibrary, getLibraryById } from '@/lib/db';
import { uploadToBlob, copyBlob } from '@/lib/blob-utils';
import axios from 'axios';

async function downloadImageBuffer(url: string): Promise<Buffer | null> {
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'arraybuffer',
            timeout: 15000
        });
        return Buffer.from(response.data);
    } catch (e) {
        console.error('Failed to download image from blob:', url, e);
        return null;
    }
}

export async function POST(req: NextRequest) {
    try {
        await initDb();
        const { name, products, originalLibraryId } = await req.json();
        if (!products || products.length === 0) {
            return NextResponse.json({ error: 'No products' }, { status: 400 });
        }

        const id = crypto.randomUUID();
        let excelUrl = '';

        // 1. Try to copy original Excel from Blob if originalLibraryId exists
        if (originalLibraryId) {
            const sourceLib = await getLibraryById(originalLibraryId);
            if (sourceLib && sourceLib.excel_url) {
                try {
                    excelUrl = await copyBlob(sourceLib.excel_url, `libraries/${id}.xlsx`);
                } catch (copyError) {
                    console.error('Failed to copy blob, falling back to generation:', copyError);
                }
            }
        }

        // 2. Fallback: Generate new Excel and upload to Blob
        if (!excelUrl) {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Completed Selection');
            
            const allKeys = new Set<string>();
            products.forEach((p: any) => {
                Object.keys(p).forEach(k => {
                    if (!k.startsWith('_')) allKeys.add(k);
                });
            });
            
            let keys = Array.from(allKeys);
            const columns = keys.map(key => ({ header: key, key: key, width: 25 }));
            worksheet.columns = columns;

            for (let i = 0; i < products.length; i++) {
                const rowData = { ...products[i] };
                worksheet.addRow(rowData);
                
                // If there's an image URL, we might want to embed it? 
                // For now, let's keep it simple as the original code did.
            }
            
            const outBuffer = await workbook.xlsx.writeBuffer();
            excelUrl = await uploadToBlob(`libraries/${id}.xlsx`, Buffer.from(outBuffer), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        }

        // 3. Save to Postgres
        const metadata = {
            id,
            name: name || `Selection_${new Date().getTime()}`,
            type: 'completed' as const,
            timestamp: Date.now(),
            excel_url: excelUrl,
            products,
            original_library_id: originalLibraryId
        };
        await saveLibrary(metadata);

        return NextResponse.json({ success: true, id });
    } catch (error: any) {
        console.error('Save completed error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
