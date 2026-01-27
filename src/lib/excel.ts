import * as XLSX from 'xlsx';

export interface Product {
  // 核心显示字段（标准 Key）
  '主图src': string;
  '商品标题': string;
  '商品售价': string | number;
  '邮费': string | number;
  '类目': string;
  '评分': string | number;
  '商店名称': string;
  '店铺销量': string | number;
  '总销量': string | number;
  '近7天销量': string | number;
  '总销售额': string | number;
  '近7天销售额': string | number;
  '关联达人': string | number;
  '达人出单率': string | number;
  '关联视频': string | number;
  '视频曝光量': string | number;
  '中文商品名'?: string;
  '场景用途'?: string;
  
  [key: string]: any;
}

export const exportToExcel = (products: Product[], fileName: string = 'liked_products.xlsx') => {
  const dataToExport = products.map(p => {
    const { ...cleanProduct } = p;
    // 移除所有辅助性质的 Key，只保留业务数据
    delete cleanProduct._index;
    return cleanProduct;
  });

  const worksheet = XLSX.utils.json_to_sheet(dataToExport);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Liked');
  XLSX.writeFile(workbook, fileName);
};
