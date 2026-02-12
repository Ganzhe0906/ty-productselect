import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import axios from 'axios';
import crypto from 'crypto';
import { uploadToBlob } from '@/lib/blob-utils';
import { initDb, saveLibrary } from '@/lib/db';

async function downloadImageBuffer(url: string): Promise<Buffer> {
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': ''
        },
        timeout: 15000
    });
    return Buffer.from(response.data);
}

export async function POST(req: NextRequest) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const sendProgress = (progress: number, message: string) => {
                controller.enqueue(encoder.encode(JSON.stringify({ type: 'progress', progress, message }) + '\n'));
            };

            const sendError = (message: string) => {
                controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message }) + '\n'));
                controller.close();
            };

            const sendSuccess = (data: any) => {
                controller.enqueue(encoder.encode(JSON.stringify({ type: 'success', data }) + '\n'));
                controller.close();
            };

            try {
                const { data, headers, finalColumns, srcField, fileName, saveToLibrary } = await req.json();

                if (!data || !Array.isArray(data)) {
                    sendError('No data provided');
                    return;
                }

                const id = crypto.randomUUID();
                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Localized Products');
                
                // 设置列定义，排除私有字段
                worksheet.columns = finalColumns;

                // 图片处理与 Excel 构建
                sendProgress(5, '🖼️ 正在抓取并嵌入永久图片...');
                
                const processedProducts = [];
                
                for (let i = 0; i < data.length; i++) {
                    const rowData = data[i];
                    const rowIndex = i + 2; // Excel row index
                    const progress = 5 + Math.floor((i / data.length) * 80);
                    
                    if (i % 5 === 0 || i === data.length - 1) {
                        sendProgress(progress, `🖼️ 正在处理图片 (${i + 1}/${data.length})...`);
                    }

                    const originalUrl = rowData._original_image_url_;
                    const cleanRowData = { ...rowData };
                    // 准备存入数据库的数据，包含私有属性
                    const productData = { ...rowData, _index: rowIndex };

                    const row = worksheet.addRow(cleanRowData);
                    row.height = 100;

                    if (originalUrl && originalUrl.startsWith('http')) {
                        try {
                            const imageBuffer = await downloadImageBuffer(originalUrl);
                            const extension = originalUrl.toLowerCase().includes('.png') ? 'png' : 'jpeg';
                            const imageId = workbook.addImage({
                                buffer: imageBuffer as any,
                                extension: extension as 'jpeg' | 'png',
                            });

                            const colIndex = finalColumns.findIndex((c: any) => c.key === srcField || c.header === '主图');
                            const actualCol = colIndex !== -1 ? colIndex : 0;

                            worksheet.addImage(imageId, {
                                tl: { col: actualCol, row: rowIndex - 1 },
                                ext: { width: 120, height: 120 },
                                editAs: 'oneCell'
                            });
                            
                            // 单元格文字置空，只留图片
                            row.getCell(actualCol + 1).value = ' ';
                        } catch (error: any) {
                            console.error(`图片下载失败: ${originalUrl}`, error.message);
                        }
                    }
                    processedProducts.push(productData);
                }

                sendProgress(90, '✨ 正在生成并上传永久母版至 R2...');
                const outBuffer = await workbook.xlsx.writeBuffer();
                
                // 直接上传到 R2
                const excelUrl = await uploadToBlob(`libraries/${id}.xlsx`, Buffer.from(outBuffer), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

                // 如果需要存入库
                if (saveToLibrary) {
                    sendProgress(95, '🗄️ 正在保存至选品数据库...');
                    await initDb();
                    await saveLibrary({
                        id,
                        name: fileName || `Localized_${Date.now()}`,
                        type: 'pending',
                        timestamp: Date.now(),
                        excel_url: excelUrl,
                        products: processedProducts
                    });
                }

                sendProgress(100, '✅ 处理完成！数据已永久化存储。');
                sendSuccess({ id, excelUrl, name: fileName });

            } catch (error: any) {
                console.error('💥 Finalize API 错误:', error);
                sendError(error.message);
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}
