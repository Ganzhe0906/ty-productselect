import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import axios from 'axios';
import { initDb, getLibraryById } from '@/lib/db';

async function downloadBuffer(url: string): Promise<Buffer> {
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'arraybuffer',
            timeout: 30000
        });
        return Buffer.from(response.data);
    } catch (e: any) {
        console.error(`Failed to download from ${url}:`, e.message);
        throw e;
    }
}

export async function POST(req: NextRequest) {
    try {
        const { products: rawProducts, libraryId } = await req.json();

        if (!rawProducts || !Array.isArray(rawProducts) || rawProducts.length === 0) {
            return NextResponse.json({ error: 'No products to export' }, { status: 400 });
        }

        console.log(`[Export] Starting export for ${rawProducts.length} products. LibraryId: ${libraryId}`);

        const products = rawProducts;
        const workbook = new ExcelJS.Workbook();
        let worksheet = workbook.addWorksheet('Liked Products');
        let sourceSheet: ExcelJS.Worksheet | null = null;

        // 如果提供了 libraryId，尝试从 R2 加载原始 Excel 作为模板
        if (libraryId) {
            try {
                await initDb();
                const lib = await getLibraryById(libraryId);
                
                let excelUrl = lib?.excel_url;
                
                // 如果是已完成库且没有 excelUrl（理论上不应该），尝试找原始库
                if (!excelUrl && lib?.original_library_id) {
                    const originalLib = await getLibraryById(lib.original_library_id);
                    excelUrl = originalLib?.excel_url;
                }

                if (excelUrl) {
                    console.log(`[Export] Loading source template from ${excelUrl}`);
                    const buffer = await downloadBuffer(excelUrl);
                    const sourceWorkbook = new ExcelJS.Workbook();
                    await sourceWorkbook.xlsx.load(buffer as any);
                    sourceSheet = sourceWorkbook.getWorksheet(1) || null;
                    console.log(`[Export] Source template loaded successfully`);
                }
            } catch (err) {
                console.error('[Export] Failed to load original excel from R2:', err);
            }
        }

        let keys: string[] = [];

        if (sourceSheet) {
            // 使用原始文件的表头
            const headerRow = sourceSheet.getRow(1);
            headerRow.eachCell((cell, colNumber) => {
                keys.push(String(cell.value || ''));
            });
            
            // 设置新表的列宽和表头
            worksheet.columns = keys.map((key, i) => ({
                header: key,
                key: `col_${i}`,
                width: sourceSheet!.getColumn(i + 1).width || 25
            }));
        } else {
            // 回退到基于 JSON 的逻辑
            const allKeys = new Set<string>();
            products.forEach(p => {
                Object.keys(p).forEach(k => {
                    if (!k.startsWith('_')) allKeys.add(k);
                });
            });
            
            const knownTitleHeaders = ['商品标题', '商品名', 'title', 'name'];
            keys = Array.from(allKeys);
            const titleField = keys.find(k => knownTitleHeaders.includes(k));
            
            if (titleField) {
                const hasChineseName = allKeys.has('中文商品名');
                const hasScenario = allKeys.has('场景用途');
                if (hasChineseName) keys = keys.filter(k => k !== '中文商品名');
                if (hasScenario) keys = keys.filter(k => k !== '场景用途');
                const titleIdx = keys.indexOf(titleField);
                if (hasScenario) keys.splice(titleIdx + 1, 0, '场景用途');
                if (hasChineseName) keys.splice(titleIdx + 1, 0, '中文商品名');
            }

            worksheet.columns = keys.map((key, index) => ({ 
                header: key || `Col ${index + 1}`, 
                key: key || `__col_${index}__`, 
                width: (key === '中文商品名' || key === '场景用途') ? 30 : 25 
            }));
        }

        // 设置表头样式
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 30;

        // 并行处理图片和行数据
        const CONCURRENCY = 5; // 控制并发数，避免请求过多
        const results = [];
        
        console.log(`[Export] Processing rows with concurrency ${CONCURRENCY}...`);

        for (let i = 0; i < products.length; i += CONCURRENCY) {
            const chunk = products.slice(i, i + CONCURRENCY);
            const chunkPromises = chunk.map(async (p, index) => {
                const globalIndex = i + index;
                const rowNum = globalIndex + 2; // 表头占一行

                // 1. 确定图片路径 (Blob URL)
                const imageUrl = p['主图src'] || p.src || '';

                // 2. 构造行数据
                let rowData: any[] = [];
                let rowObject: any = {};
                
                if (sourceSheet && p._index) {
                    const sourceRow = sourceSheet.getRow(p._index);
                    sourceRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                        rowData[colNumber - 1] = cell.value;
                    });
                } else {
                    keys.forEach((key, kIndex) => {
                        const internalKey = worksheet.columns[kIndex].key!;
                        rowObject[internalKey] = p[key];
                    });
                }

                return { p, rowData, rowObject, imageUrl, rowNum };
            });

            const processedChunk = await Promise.all(chunkPromises);
            
            for (const item of processedChunk) {
                const { p, rowData, rowObject, imageUrl, rowNum } = item;
                const newRow = rowData.length > 0 ? worksheet.addRow(rowData) : worksheet.addRow(rowObject);
                newRow.height = 100;
                newRow.alignment = { vertical: 'middle', horizontal: 'center' };

                // 处理图片嵌入 (这一步比较慢，我们也可以尝试并行下载图片，但插入必须是顺序的或通过 API 引用)
                // 为了简单和稳定性，我们在添加完行后再异步下载图片并插入
            }
        }

        // 再次循环处理图片 (并行下载)
        console.log(`[Export] Downloading and embedding images...`);
        const imageTasks = products.map(async (p, i) => {
            const rowNumber = i + 2;
            const imageUrl = p['主图src'] || p.src || '';
            const firstCell = worksheet.getRow(rowNumber).getCell(1);
            let hasAddedImage = false;

            // A. 尝试从原始 Excel 中提取图片
            if (sourceSheet && p._index) {
                const images = sourceSheet.getImages();
                const originalImage = images.find(img => 
                    Math.round(img.range.tl.nativeRow) === (Number(p._index) - 1)
                );

                if (originalImage) {
                    try {
                        const imgData = sourceSheet.workbook.getImage(originalImage.imageId as any);
                        if (imgData && imgData.buffer) {
                            const extension = imgData.extension || 'png';
                            const imageId = workbook.addImage({
                                buffer: imgData.buffer as ArrayBuffer,
                                extension: extension,
                            });

                            worksheet.addImage(imageId, {
                                tl: { col: 0, row: rowNumber - 1 },
                                ext: { width: 120, height: 120 },
                                editAs: 'oneCell'
                            });
                            hasAddedImage = true;
                            firstCell.value = ' '; 
                        }
                    } catch (err) {
                        // console.error('Failed to copy image from original excel:', err);
                    }
                }
            }

            // B. 尝试下载图片 URL
            if (!hasAddedImage && imageUrl && imageUrl.startsWith('http')) {
                try {
                    const imageBuffer = await downloadBuffer(imageUrl);
                    
                    let extension: 'png' | 'jpeg' | 'gif' = 'jpeg';
                    const lowerUrl = imageUrl.toLowerCase();
                    if (lowerUrl.includes('.png')) extension = 'png';
                    else if (lowerUrl.includes('.gif')) extension = 'gif';
                    
                    const imageId = workbook.addImage({
                        buffer: imageBuffer as any,
                        extension: extension,
                    });

                    worksheet.addImage(imageId, {
                        tl: { col: 0, row: rowNumber - 1 },
                        ext: { width: 120, height: 120 },
                        editAs: 'oneCell'
                    });
                    hasAddedImage = true;
                    firstCell.value = ' '; 
                } catch (e: any) {
                    // console.error(`导出图片失败: ${e.message}`);
                }
            }

            if (!hasAddedImage) {
                firstCell.value = imageUrl ? '图片加载失败' : '无图片';
            }
        });

        // 限制并发下载图片
        for (let i = 0; i < imageTasks.length; i += 10) {
            await Promise.all(imageTasks.slice(i, i + 10));
            console.log(`[Export] Image download progress: ${Math.min(i + 10, imageTasks.length)}/${imageTasks.length}`);
        }

        console.log(`[Export] Writing workbook to buffer...`);
        const outBuffer = await workbook.xlsx.writeBuffer();
        console.log(`[Export] Workbook buffer size: ${outBuffer.byteLength} bytes`);

        return new NextResponse(outBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="selection_results_${Date.now()}.xlsx"`
            }
        });

    } catch (error: any) {
        console.error('[Export] Critical error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
