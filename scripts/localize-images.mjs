import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import cliProgress from 'cli-progress';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const INPUT_FILE = path.join(ROOT_DIR, 'products.xlsx');
const OUTPUT_FILE = path.join(ROOT_DIR, 'products_local_with_images.xlsx');
const IMAGE_DIR = path.join(ROOT_DIR, 'public', 'images', 'products');

async function downloadImageBuffer(url) {
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

async function main() {
    try {
        console.log('🚀 正在启动图片嵌入处理（不保存本地模式）...');
        
        if (!fs.existsSync(INPUT_FILE)) {
            console.error(`❌ 错误: 找不到输入文件 ${INPUT_FILE}`);
            process.exit(1);
        }

        const workbookXLSX = XLSX.readFile(INPUT_FILE);
        const sheetName = workbookXLSX.SheetNames[0];
        const data = XLSX.utils.sheet_to_json(workbookXLSX.Sheets[sheetName]);

        if (data.length === 0) {
            console.warn('⚠️ 没有数据。');
            return;
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Localized Products');
        
        const columns = Object.keys(data[0]).map(key => ({ header: key, key: key, width: 25 }));
        worksheet.columns = columns;

        const progressBar = new cliProgress.SingleBar({
            format: '嵌入进度 |{bar}| {percentage}% | {value}/{total} 张 | {msg}',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true
        }, cliProgress.Presets.shades_classic);

        progressBar.start(data.length, 0, { msg: '开始处理...' });

        for (let i = 0; i < data.length; i++) {
            const rowData = data[i];
            const rowIndex = i + 2;
            const row = worksheet.addRow({
                ...rowData
            });
            row.height = 100;

            const srcField = rowData.src ? 'src' : (rowData['主图src'] ? '主图src' : null);
            const src = srcField ? rowData[srcField] : null;

            if (src) {
                try {
                    const imageBuffer = await downloadImageBuffer(src);
                    
                    const extension = src.toLowerCase().includes('.png') ? 'png' : 'jpeg';
                    const imageId = workbook.addImage({
                        buffer: imageBuffer,
                        extension: extension,
                    });

                    const colIndex = columns.findIndex(c => c.key === srcField);
                    if (colIndex !== -1) {
                        worksheet.addImage(imageId, {
                            tl: { col: colIndex, row: rowIndex - 1 },
                            ext: { width: 120, height: 120 }
                        });
                        row.getCell(colIndex + 1).value = ' '; // 彻底清除 URL
                    }
                } catch (e) {
                    // ignore error
                }
            }
            progressBar.update(i + 1, { msg: `处理中: ${rowData['Product ID'] || i}` });
        }

        progressBar.stop();
        console.log('📝 正在导出文件...');
        await workbook.xlsx.writeFile(OUTPUT_FILE);

        console.log(`\n✨ 完成！带图片的 Excel 已生成: ${OUTPUT_FILE}`);

    } catch (error) {
        console.error('\n💥 错误:', error);
    }
}

main();
