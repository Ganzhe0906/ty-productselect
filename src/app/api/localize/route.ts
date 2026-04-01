import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import axios from 'axios';
import { summarizeProductNamesBatch } from '@/lib/gemini';

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

function extractUrl(src: any): string {
    if (!src) return '';
    
    let url = '';
    if (typeof src === 'object' && src !== null) {
        url = src.hyperlink || src.text || '';
    } else {
        url = String(src);
    }

    if (!url) return '';
    
    // 1. 尝试从 HTML 标签中提取 src
    const srcMatch = url.match(/src=["']?([^"'\s>]+)["']?/i);
    if (srcMatch && srcMatch[1]) {
        return srcMatch[1];
    }
    
    // 2. 尝试直接寻找 http(s) 链接
    const urlMatch = url.match(/(https?:\/\/[^\s"'<>]+)/i);
    if (urlMatch && urlMatch[0]) {
        return urlMatch[0];
    }

    return url.trim();
}

export async function POST(req: NextRequest) {
    console.log('📬 收到本地化请求（流式进度模式）');
    
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
                const formData = await req.formData();
                const file = formData.get('file') as File;
                const apiKey = formData.get('apiKey') as string;
                const model = formData.get('model') as string;

                if (!file) {
                    sendError('No file uploaded');
                    return;
                }

                sendProgress(5, '正在解析 Excel 文件...');
                const bytes = await file.arrayBuffer();
                const buffer = Buffer.from(bytes);

                const workbookXLSX = XLSX.read(buffer, { type: 'buffer' });
                const sheetName = workbookXLSX.SheetNames[0];
                const worksheetXLSX = workbookXLSX.Sheets[sheetName];
                
                const rawData = XLSX.utils.sheet_to_json(worksheetXLSX, { header: 1, defval: "" }) as any[][];
                if (rawData.length === 0) {
                    sendError('Excel is empty');
                    return;
                }

                const headers = rawData[0] as string[];
                const rows = rawData.slice(1);

                let srcField = '';
                let titleField = '';
                const knownImageHeaders = ['主图src', 'src', '_original_url_', '主图'];
                const knownTitleHeaders = ['商品标题', '商品名', 'title', 'name'];
                
                const foundImageHeader = headers.find(h => knownImageHeaders.includes(h));
                const foundTitleHeader = headers.find(h => knownTitleHeaders.includes(h));
                
                if (foundImageHeader) srcField = foundImageHeader;
                else if (headers.length > 0) srcField = headers[0];

                if (foundTitleHeader) titleField = foundTitleHeader;

                const data = rows.map(row => {
                    const obj: any = {};
                    headers.forEach((h, i) => {
                        obj[h] = row[i];
                    });
                    return obj;
                });

                const workbook = new ExcelJS.Workbook();
                const worksheet = workbook.addWorksheet('Localized Products');

                const finalColumns: { header: string, key: string, width: number }[] = [];
                headers.forEach(k => {
                    if (k && !k.startsWith('_')) {
                        finalColumns.push({ header: k, key: k, width: 25 });
                        if (k === titleField) {
                            finalColumns.push({ header: '中文商品名', key: '中文商品名', width: 30 });
                            finalColumns.push({ header: '场景用途', key: '场景用途', width: 30 });
                        }
                    }
                });
                
                if (titleField && !finalColumns.find(c => c.key === '中文商品名')) {
                     const titleIdx = finalColumns.findIndex(c => c.key === titleField);
                     if (titleIdx !== -1) {
                         finalColumns.splice(titleIdx + 1, 0, { header: '中文商品名', key: '中文商品名', width: 30 });
                         finalColumns.splice(titleIdx + 2, 0, { header: '场景用途', key: '场景用途', width: 30 });
                     }
                }

                finalColumns.push({ header: '主图src', key: '主图src', width: 25 });
                worksheet.columns = finalColumns;

                // 3. 批量处理 AI 总结 (每 30 条一组)
                if (apiKey && titleField) {
                    const totalBatches = Math.ceil(data.length / 30);
                    sendProgress(10, `🤖 正在准备 AI 总结 (共 ${totalBatches} 批)...`);
                    
                    for (let i = 0; i < data.length; i += 30) {
                        const batchIndex = Math.floor(i / 30) + 1;
                        const batch = data.slice(i, i + 30);
                        const titles = batch.map(d => d[titleField]).filter(Boolean);
                        
                        if (titles.length > 0) {
                            const progress = 10 + Math.floor((batchIndex / totalBatches) * 70);
                            sendProgress(progress, `[AI] 正在分析商品名与场景 (第 ${batchIndex}/${totalBatches} 批)...`);
                            
                            try {
                                const summaries = await summarizeProductNamesBatch(titles, apiKey, model);
                                if (summaries.length === 0) {
                                    throw new Error(`AI 总结返回结果为空，请检查 API Key 是否有效或网络是否通畅。`);
                                }
                                summaries.forEach((res, index) => {
                                    if (batch[index]) {
                                        batch[index]['中文商品名'] = res.name;
                                        batch[index]['场景用途'] = res.scenario;
                                    }
                                });
                            } catch (err: any) {
                                console.error(`批次 ${batchIndex} AI 处理失败:`, err);
                                throw new Error(`AI 处理失败 (第 ${batchIndex} 批): ${err.message}`);
                            }
                        }
                    }
                }

                // 4. 图片处理
                sendProgress(80, '🖼️ 正在处理图片下载与嵌入...');
                for (let i = 0; i < data.length; i++) {
                    const rowData = data[i];
                    const rowIndex = i + 2;
                    const progress = 80 + Math.floor((i / data.length) * 15);
                    
                    if (i % 10 === 0 || i === data.length - 1) {
                        sendProgress(progress, `🖼️ 正在处理图片 (${i + 1}/${data.length})...`);
                    }

                    const rawUrl = rowData[srcField];
                    const originalUrl = extractUrl(rawUrl);
                    const cleanRowData = { ...rowData };
                    
                    if (srcField) cleanRowData[srcField] = ' ';
                    delete cleanRowData['_original_url_'];

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

                            const colIndex = finalColumns.findIndex(c => c.key === srcField);
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
                console.error('💥 API 错误:', error);
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
