import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import axios from 'axios';

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

            const sendFile = (base64: string) => {
                controller.enqueue(encoder.encode(JSON.stringify({ type: 'file', data: base64 }) + '\n'));
                controller.close();
            };

            try {
                const { data, headers, finalColumns, srcField } = await req.json();

                if (!data || !Array.isArray(data)) {
                    sendError('No data provided');
                    return;
                }

                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Localized Products');
                worksheet.columns = finalColumns;

                // 图片处理
                sendProgress(5, '🖼️ 正在开始图片下载与嵌入...');
                
                for (let i = 0; i < data.length; i++) {
                    const rowData = data[i];
                    const rowIndex = i + 2;
                    const progress = 5 + Math.floor((i / data.length) * 90);
                    
                    if (i % 10 === 0 || i === data.length - 1) {
                        sendProgress(progress, `🖼️ 正在处理图片 (${i + 1}/${data.length})...`);
                    }

                    const originalUrl = rowData._original_image_url_;
                    const cleanRowData = { ...rowData };
                    delete cleanRowData['_original_image_url_'];

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

                            const colIndex = finalColumns.findIndex((c: any) => c.key === srcField);
                            if (colIndex !== -1) {
                                worksheet.addImage(imageId, {
                                    tl: { col: colIndex, row: rowIndex - 1 },
                                    ext: { width: 120, height: 120 },
                                    editAs: 'oneCell'
                                });
                            }
                        } catch (error: any) {
                            console.error(`图片下载失败: ${originalUrl}`, error.message);
                        }
                    }
                }

                sendProgress(98, '✨ 正在生成最终 Excel 文件...');
                const outBuffer = await workbook.xlsx.writeBuffer();
                const base64 = Buffer.from(outBuffer).toString('base64');
                
                sendProgress(100, '✅ 处理完成，正在准备下载...');
                sendFile(base64);

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
