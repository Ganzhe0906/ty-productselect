import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

// Helper for concurrency control
async function pLimit<T>(
  fns: (() => Promise<T>)[],
  limit: number,
  onProgress?: (current: number, total: number) => void
): Promise<T[]> {
  const results: T[] = [];
  const running: Promise<any>[] = [];
  let completed = 0;

  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i];
    const promise = fn().then((res) => {
      completed++;
      if (onProgress) {
        onProgress(completed, fns.length);
      }
      results[i] = res;
      running.splice(running.indexOf(promise), 1);
      return res;
    });
    running.push(promise);
    if (running.length >= limit) {
      await Promise.race(running);
    }
  }
  await Promise.all(running);
  return results;
}


export const parseMode3Middleware = async (file: File, onProgress?: (message: string) => void): Promise<File> => {
    onProgress?.('正在读取 Excel 文件...');
    const arrayBuffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);
    const worksheet = workbook.worksheets[0];

    // 1. 扫描第一行建立动态表头字典
    const headerMap = new Map<string, number>();
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
        const headerValue = cell.text?.trim().toLowerCase() || '';
        if (headerValue) headerMap.set(headerValue, colNumber);
    });

    // 2. 智能查找真实列号的辅助函数
    const findColumnIndex = (possibleNames: string[]): number => {
        for (const name of possibleNames) {
            if (headerMap.has(name.toLowerCase())) return headerMap.get(name.toLowerCase())!;
        }
        return -1;
    };

    // 3. 动态获取核心字段的真实列号
    const titleCol = findColumnIndex(['product name', 'title', '商品名称', '标题', '商品名', '商品标题']);
    const priceCol = findColumnIndex(['price', 'est. price', '价格', '售价', '价格($)']);
    const salesCol = findColumnIndex(['est. sales', 'sales', '总销量', '销量', '月销量']);

    // 1. 提取所有内嵌图片并构建坐标映射 (row -> image buffer)
    const imageMap = new Map<number, { buffer: ArrayBuffer, name: string, extension: string }>();

    for (const image of worksheet.getImages()) {
        const imgId = image.imageId;
        const imgData = workbook.getImage(parseInt(imgId));

        // [修复] 稳妥获取行号：优先 nativeRow，退回 row，确保不出现 NaN
        const tl = image.range?.tl;
        if (!tl) continue;
        const rawRow = tl.nativeRow !== undefined ? tl.nativeRow : tl.row;
        const rowNum = Math.floor(rawRow) + 1;

        if (imgData && imgData.buffer) {
            // Log for debugging offset (前三行)
            if (rowNum <= 3) {
                console.log(`[DEBUG] Image found at Excel row: ${rowNum}, Image ID: ${imgId}, Extension: ${imgData.extension}`);
            }
            const arrayBuffer = new Uint8Array(imgData.buffer).buffer;
            imageMap.set(rowNum, { buffer: arrayBuffer, name: `mode3_img_${rowNum}.${imgData.extension}`, extension: imgData.extension as string });
        }
    }
    console.log(`[DEBUG] Found ${imageMap.size} embedded images.`);


    const normalizedData: any[] = [];
    const uploadTasks: (() => Promise<any>)[] = [];

    // 收集图片上传任务
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // 跳过表头

        const rowData: any = {
            '主图src': '', // [新增] 强行占位，确保生成的 Excel 一定有这两列
            '_original_url_': '', // [新增] 强行占位
            '商品标题': titleCol !== -1 ? row.getCell(titleCol).text || '' : '',
            '价格': priceCol !== -1 ? row.getCell(priceCol).text || '' : '',
            '总销量': salesCol !== -1 ? row.getCell(salesCol).text || '' : '',
        };

        // 严格测试行号偏移量：exceljs 的 eachRow 是 1-indexed, range.tl.row 也是 1-indexed
        // 所以 imageMap 的 key 应该直接对应 eachRow 的 rowNumber
        if (imageMap.has(rowNumber)) {
            const imgInfo = imageMap.get(rowNumber)!;
            const imgFile = new File([imgInfo.buffer], imgInfo.name, { type: `image/${imgInfo.extension}` });

            uploadTasks.push(async () => {
                onProgress?.(`正在上传图片: ${imgInfo.name}`);
                const formData = new FormData();
                formData.append('file', imgFile);

                const uploadRes = await fetch('/api/upload-image', { method: 'POST', body: formData });
                if (!uploadRes.ok) {
                    const errorData = await uploadRes.json();
                    throw new Error(`图片上传失败: ${imgInfo.name} - ${errorData.error || uploadRes.statusText}`);
                }
                const uploadData = await uploadRes.json();
                return { rowNumber, url: uploadData.url };
            });
        }
        normalizedData.push(rowData);
    });

    // 2. 遍历数据行，清洗表头并提前上传图片 (带并发控制)
    onProgress?.(`正在上传 ${uploadTasks.length} 张图片 (0/${uploadTasks.length})...`);
    const uploadedImageResults = await pLimit(uploadTasks, 5, (completed, total) => {
        onProgress?.(`正在上传 ${total} 张图片 (${completed}/${total})...`);
    });
    console.log('[DEBUG] Uploaded image results:', uploadedImageResults);

    // 将上传结果合并回 normalizedData
    uploadedImageResults.forEach(result => {
        const dataIndex = result.rowNumber - 2; // eachRow跳过第一行(header), normalizedData从第二行开始是第一个数据
        if (normalizedData[dataIndex]) {
            normalizedData[dataIndex]['主图src'] = result.url;
            normalizedData[dataIndex]['_original_url_'] = result.url;
        }
    });

    // 3. 将清洗后的 JSON 重新打包为模式 1 兼容的 Excel File
    onProgress?.('正在重构数据为兼容模式...');
    const newWorksheet = XLSX.utils.json_to_sheet(normalizedData);
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, "Sheet1");

    const excelBuffer = XLSX.write(newWorkbook, { bookType: 'xlsx', type: 'array' });
    onProgress?.('数据重构完成。');
    return new File([excelBuffer], `Normalized_${file.name}`, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
};
